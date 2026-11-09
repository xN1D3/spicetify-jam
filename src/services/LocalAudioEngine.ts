// Local Audio Engine for Spicetify Jam
// Plays local audio files (MP3, WAV, FLAC, M4A, OGG) with 100% Studio Quality & Zero Ads
// Supports P2P Audio Transfer over PeerJS WebRTC

export interface LocalAudioStatus {
    currentMs: number;
    durationMs: number;
    isPlaying: boolean;
    isReady: boolean;
    localId: string | null;
}

export interface LocalFileRecord {
    localId: string;
    name: string;
    title: string;
    artist: string;
    durationMs: number;
    mimeType: string;
    blobUrl: string;
    file?: File;
    arrayBuffer?: ArrayBuffer;
}

/**
 * Infer correct MIME type from file extension and raw MIME type
 */
export function detectMimeType(filename: string, rawType?: string): string {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    switch (ext) {
        case 'mp3':
            return 'audio/mpeg';
        case 'wav':
            return 'audio/wav';
        case 'flac':
            return 'audio/flac';
        case 'ogg':
            return 'audio/ogg';
        case 'opus':
            return 'audio/opus';
        case 'webm':
            return 'audio/webm';
        case 'm4a':
            return 'audio/mp4';
        case 'aac':
            return 'audio/aac';
        case 'alac':
            return 'audio/x-alac';
        default:
            if (rawType && rawType.startsWith('audio/')) return rawType;
            return 'audio/mpeg';
    }
}

/**
 * Validates whether Spotify CEF can decode the given audio file
 */
export function canPlayAudioFile(filename: string, rawType?: string): { supported: boolean; mimeType: string; reason?: string } {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const mimeType = detectMimeType(filename, rawType);

    // Spotify Desktop runs on Chromium Embedded Framework (CEF) without proprietary patent-encumbered codecs (AAC/ALAC).
    // .m4a files almost always contain AAC or ALAC streams which CEF's HTML5 <audio> rejects with MEDIA_ERR_SRC_NOT_SUPPORTED.
    if (ext === 'm4a' || ext === 'aac' || ext === 'alac' || mimeType === 'audio/mp4' || mimeType === 'audio/aac') {
        try {
            const testAudio = document.createElement('audio');
            const canMp4 = testAudio.canPlayType('audio/mp4; codecs="mp4a.40.2"') || testAudio.canPlayType('audio/mp4');
            const canAac = testAudio.canPlayType('audio/aac');
            if (!canMp4 && !canAac) {
                return {
                    supported: false,
                    mimeType,
                    reason: 'Spotify CEF lacks proprietary AAC/ALAC codecs. Please convert the file to .mp3, .flac, or .wav.'
                };
            }
        } catch {
            return {
                supported: false,
                mimeType,
                reason: 'Spotify CEF lacks proprietary AAC/ALAC codecs. Please convert the file to .mp3, .flac, or .wav.'
            };
        }
    }

    try {
        const testAudio = document.createElement('audio');
        const can = testAudio.canPlayType(mimeType);
        if (can === '' && !['mp3', 'wav', 'flac', 'ogg', 'opus'].includes(ext)) {
            return {
                supported: false,
                mimeType,
                reason: `Audio format .${ext} (${mimeType}) is not supported by Spotify desktop player.`
            };
        }
    } catch {}

    return { supported: true, mimeType };
}

class LocalAudioEngine {
    private audioElement: HTMLAudioElement | null = null;
    private fileMap = new Map<string, LocalFileRecord>();
    private currentLocalId: string | null = null;
    private isPlaying = false;
    private cachedCurrentMs = 0;
    private cachedDurationMs = 0;

    public onTrackEnded: (() => void) | null = null;
    public onStateChange: ((isPlaying: boolean) => void) | null = null;

    constructor() {
        this.init();
    }

    private init() {
        if (typeof document === 'undefined') return;
        this.getOrCreateAudioElement();

        // Unlock audio on click if needed
        const unlock = () => {
            if (this.isPlaying && this.currentLocalId && this.audioElement && this.audioElement.paused) {
                this.audioElement.play().catch(() => {});
                this.syncVolume();
            }
        };
        document.addEventListener('click', unlock, { passive: true });
    }

    private getOrCreateAudioElement(): HTMLAudioElement {
        if (!this.audioElement) {
            this.audioElement = new Audio();
            this.audioElement.id = 'jam-local-audio';
            this.audioElement.preload = 'auto';

            this.audioElement.addEventListener('play', () => {
                this.isPlaying = true;
                this.onStateChange?.(true);
            });

            this.audioElement.addEventListener('pause', () => {
                this.isPlaying = false;
                this.onStateChange?.(false);
            });

            this.audioElement.addEventListener('ended', () => {
                this.isPlaying = false;
                this.onStateChange?.(false);
                this.onTrackEnded?.();
            });

            this.audioElement.addEventListener('timeupdate', () => {
                if (this.audioElement) {
                    this.cachedCurrentMs = Math.round(this.audioElement.currentTime * 1000);
                    if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
                        this.cachedDurationMs = Math.round(this.audioElement.duration * 1000);
                    }
                }
            });

            this.audioElement.addEventListener('error', (e) => {
                const err = this.audioElement?.error;
                console.warn('[Jam Local Audio] Playback error:', err?.code, err?.message, e);
                if (err && err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                    try {
                        Spicetify.showNotification('⚠️ Audio playback failed: Unsupported codec (e.g. M4A/AAC). Please use MP3/FLAC/WAV.', true);
                    } catch {}
                }
            });
        }
        return this.audioElement;
    }

    /**
     * Parse File object into LocalFileRecord, read duration, generate localId and ObjectURL
     */
    public async registerLocalFile(file: File): Promise<LocalFileRecord> {
        const localId = `jam:local:${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const blobUrl = URL.createObjectURL(file);

        // Parse artist & title from filename e.g. "Artist - Title.mp3"
        let name = file.name.replace(/\.[^/.]+$/, ''); // strip extension
        let title = name;
        let artist = 'Local Audio';

        if (name.includes(' - ')) {
            const parts = name.split(' - ');
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
        }

        // Extract duration via temp Audio element
        const durationMs = await new Promise<number>((resolve) => {
            const temp = new Audio(blobUrl);
            let done = false;
            const onMeta = () => {
                if (done) return;
                done = true;
                const d = Math.round((temp.duration || 0) * 1000);
                temp.removeEventListener('loadedmetadata', onMeta);
                temp.removeEventListener('error', onError);
                temp.src = '';
                resolve(d > 0 ? d : 0);
            };
            const onError = () => {
                if (done) return;
                done = true;
                temp.removeEventListener('loadedmetadata', onMeta);
                temp.removeEventListener('error', onError);
                temp.src = '';
                resolve(0);
            };
            temp.addEventListener('loadedmetadata', onMeta);
            temp.addEventListener('error', onError);
            // Fallback timeout in case metadata event doesn't fire
            setTimeout(() => {
                if (!done) {
                    done = true;
                    temp.removeEventListener('loadedmetadata', onMeta);
                    temp.removeEventListener('error', onError);
                    temp.src = '';
                    resolve(0);
                }
            }, 1500);
        });

        const mimeType = detectMimeType(file.name, file.type);
        const record: LocalFileRecord = {
            localId,
            name: file.name,
            title,
            artist,
            durationMs,
            mimeType,
            blobUrl,
            file
        };

        this.fileMap.set(localId, record);
        return record;
    }

    public hasLocalFile(localId: string): boolean {
        return this.fileMap.has(localId);
    }

    public getFileRecord(localId: string): LocalFileRecord | undefined {
        return this.fileMap.get(localId);
    }

    public async getFileBuffer(localId: string): Promise<ArrayBuffer | null> {
        const record = this.fileMap.get(localId);
        if (!record) return null;
        if (record.arrayBuffer) return record.arrayBuffer;
        if (record.file) {
            try {
                record.arrayBuffer = await record.file.arrayBuffer();
                return record.arrayBuffer;
            } catch (e) {
                console.error('[Jam Local Audio] Error reading ArrayBuffer:', e);
            }
        }
        return null;
    }

    /**
     * Store incoming remote audio Blob transferred over P2P WebRTC
     */
    public saveRemoteBlob(localId: string, blob: Blob, title: string, artist: string, durationMs: number, mimeType?: string): LocalFileRecord {
        const detectedMime = mimeType || detectMimeType(title, blob.type);
        const blobUrl = URL.createObjectURL(blob);
        const record: LocalFileRecord = {
            localId,
            name: title,
            title,
            artist,
            durationMs,
            mimeType: detectedMime,
            blobUrl
        };
        this.fileMap.set(localId, record);
        return record;
    }

    public syncVolume() {
        try {
            const vol = typeof (Spicetify as any).Player?.getVolume === 'function'
                ? (Spicetify as any).Player.getVolume()
                : 1;

            if (this.audioElement) {
                this.audioElement.volume = Math.max(0, Math.min(1, vol));
            }
        } catch {}
    }

    public async play(localId: string, startMs: number = 0) {
        const record = this.fileMap.get(localId);
        if (!record || !record.blobUrl) {
            console.warn('[Jam Local Audio] File not found in store for:', localId);
            return false;
        }

        const audio = this.getOrCreateAudioElement();
        this.currentLocalId = localId;
        this.cachedCurrentMs = startMs;
        if (record.durationMs > 0) this.cachedDurationMs = record.durationMs;

        if (audio.src !== record.blobUrl) {
            audio.src = record.blobUrl;
            if (startMs > 0) {
                const onLoaded = () => {
                    try { audio.currentTime = Math.max(0, startMs / 1000); } catch {}
                    audio.removeEventListener('loadedmetadata', onLoaded);
                };
                audio.addEventListener('loadedmetadata', onLoaded);
            } else {
                audio.currentTime = 0;
            }
        } else {
            if (Math.abs(audio.currentTime * 1000 - startMs) > 1500) {
                audio.currentTime = Math.max(0, startMs / 1000);
            }
        }

        this.syncVolume();

        try {
            await audio.play();
            this.isPlaying = true;
            this.onStateChange?.(true);
            return true;
        } catch (e) {
            console.warn('[Jam Local Audio] Autoplay blocked, waiting for user click:', e);
            this.isPlaying = true;
            return true;
        }
    }

    public resume() {
        if (!this.audioElement || !this.currentLocalId) return;
        this.isPlaying = true;
        this.audioElement.play().catch(() => {});
        this.syncVolume();
    }

    public pause() {
        if (!this.audioElement) return;
        this.isPlaying = false;
        this.audioElement.pause();
    }

    public stop() {
        this.isPlaying = false;
        this.currentLocalId = null;
        if (this.audioElement) {
            try {
                this.audioElement.pause();
                this.audioElement.removeAttribute('src');
                this.audioElement.load();
            } catch {}
        }
    }

    public seekTo(ms: number) {
        this.cachedCurrentMs = ms;
        if (this.audioElement) {
            try {
                this.audioElement.currentTime = Math.max(0, ms / 1000);
            } catch {}
        }
    }

    public getStatus(): LocalAudioStatus {
        if (this.audioElement && this.currentLocalId) {
            if (this.audioElement.currentTime !== undefined) {
                this.cachedCurrentMs = Math.round(this.audioElement.currentTime * 1000);
            }
            if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
                this.cachedDurationMs = Math.round(this.audioElement.duration * 1000);
            }
            this.isPlaying = !this.audioElement.paused && !this.audioElement.ended;
        }

        return {
            currentMs: this.cachedCurrentMs,
            durationMs: this.cachedDurationMs,
            isPlaying: this.isPlaying,
            isReady: !!this.audioElement?.src,
            localId: this.currentLocalId
        };
    }
}

export const localAudio = new LocalAudioEngine();
