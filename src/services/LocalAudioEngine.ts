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
                console.warn('[Jam Local Audio] Playback error:', e);
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
            const onMeta = () => {
                const d = Math.round((temp.duration || 0) * 1000);
                temp.removeEventListener('loadedmetadata', onMeta);
                temp.removeEventListener('error', onError);
                resolve(d > 0 ? d : 0);
            };
            const onError = () => {
                temp.removeEventListener('loadedmetadata', onMeta);
                temp.removeEventListener('error', onError);
                resolve(0);
            };
            temp.addEventListener('loadedmetadata', onMeta);
            temp.addEventListener('error', onError);
            // Fallback timeout in case metadata event doesn't fire
            setTimeout(() => resolve(0), 1500);
        });

        const record: LocalFileRecord = {
            localId,
            name: file.name,
            title,
            artist,
            durationMs,
            mimeType: file.type || 'audio/mpeg',
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
    public saveRemoteBlob(localId: string, blob: Blob, title: string, artist: string, durationMs: number): LocalFileRecord {
        const blobUrl = URL.createObjectURL(blob);
        const record: LocalFileRecord = {
            localId,
            name: title,
            title,
            artist,
            durationMs,
            mimeType: blob.type || 'audio/mpeg',
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
