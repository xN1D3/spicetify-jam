// YouTube Virtual Audio Engine for Spicetify Jam
// Handles hidden YouTube playback, synchronised across Jam sessions

export interface YouTubeEngineStatus {
    currentMs: number;
    durationMs: number;
    isPlaying: boolean;
    isReady: boolean;
    ytId: string | null;
}

class YouTubeEngine {
    private player: any = null;
    private isReady = false;
    private currentYtId: string | null = null;
    private isPlaying = false;
    private cachedDurationMs = 0;
    private cachedCurrentMs = 0;
    private pendingPlay: { ytId: string; startMs: number } | null = null;
    private iframe: HTMLIFrameElement | null = null;
    public onTrackEnded: (() => void) | null = null;
    public onStateChange: ((isPlaying: boolean) => void) | null = null;

    constructor() {
        this.init();
    }

    private init() {
        if (typeof document === 'undefined') return;

        // 1. Create offscreen DOM container if not exists
        let container = document.getElementById('jam-yt-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'jam-yt-container';
            container.style.cssText = 'position:fixed;width:320px;height:240px;left:-9999px;top:-9999px;pointer-events:none;z-index:-9999;';
            document.body.appendChild(container);
        }

        // Global interaction listener: unlock audio/autoplay if CEF initially blocks background iframe playback
        const unlockAudio = () => {
            if (this.pendingPlay) {
                const { ytId, startMs } = this.pendingPlay;
                this.pendingPlay = null;
                this.play(ytId, startMs);
            } else if (this.isPlaying && this.player && typeof this.player.playVideo === 'function') {
                try { this.player.playVideo(); } catch {}
            }
        };
        document.addEventListener('click', unlockAudio, { passive: true, once: true });

        // 2. Load YouTube Iframe API Script
        if (!(window as any).YT) {
            const existingScript = document.getElementById('jam-yt-api-script');
            if (!existingScript) {
                const script = document.createElement('script');
                script.id = 'jam-yt-api-script';
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }

            const prevReady = (window as any).onYouTubeIframeAPIReady;
            (window as any).onYouTubeIframeAPIReady = () => {
                if (typeof prevReady === 'function') prevReady();
                this.setupPlayer();
            };
        } else if ((window as any).YT.Player) {
            this.setupPlayer();
        }
    }

    private setupPlayer() {
        if (this.player) return;

        const container = document.getElementById('jam-yt-container');
        if (!container) return;

        const target = document.createElement('div');
        target.id = 'jam-yt-target';
        container.appendChild(target);

        try {
            const YT = (window as any).YT;
            const validOrigin = (typeof window !== 'undefined' && (window.location.protocol === 'http:' || window.location.protocol === 'https:'))
                ? window.location.origin
                : undefined;

            this.player = new YT.Player('jam-yt-target', {
                height: '240',
                width: '320',
                playerVars: {
                    autoplay: 1,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    modestbranding: 1,
                    rel: 0,
                    playsinline: 1,
                    ...(validOrigin ? { origin: validOrigin } : {})
                },
                events: {
                    onReady: (event: any) => {
                        this.isReady = true;
                        this.syncVolume();
                        if (this.pendingPlay) {
                            const { ytId, startMs } = this.pendingPlay;
                            this.pendingPlay = null;
                            this.play(ytId, startMs);
                        }
                    },
                    onStateChange: (event: any) => {
                        const state = event.data;
                        // 0 = ENDED, 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING
                        if (state === 1) {
                            this.isPlaying = true;
                            this.syncVolume();
                            this.onStateChange?.(true);
                        } else if (state === 2) {
                            this.isPlaying = false;
                            this.onStateChange?.(false);
                        } else if (state === 0) {
                            this.isPlaying = false;
                            this.onStateChange?.(false);
                            this.onTrackEnded?.();
                        }
                    },
                    onError: (err: any) => {
                        console.warn('[Jam YouTube] Player error:', err);
                        try {
                            if (typeof (Spicetify as any)?.showNotification === 'function') {
                                (Spicetify as any).showNotification(`⚠️ YouTube error (${err.data || 'blocked'}) - skipping`);
                            }
                        } catch {}
                        this.onTrackEnded?.();
                    }
                }
            });
        } catch (e) {
            console.error('[Jam YouTube] Failed to instantiate YT.Player:', e);
        }
    }

    public syncVolume() {
        try {
            const vol = typeof (Spicetify as any).Player?.getVolume === 'function'
                ? (Spicetify as any).Player.getVolume()
                : 1;
            const pct = Math.max(0, Math.min(100, Math.round(vol * 100)));
            if (this.player && typeof this.player.setVolume === 'function') {
                this.player.setVolume(pct);
                if (pct === 0 && typeof this.player.mute === 'function') {
                    this.player.mute();
                } else if (pct > 0 && typeof this.player.unMute === 'function') {
                    this.player.unMute();
                }
            }
        } catch {}
    }

    public play(ytId: string, startMs: number = 0) {
        this.currentYtId = ytId;
        const startSec = Math.max(0, Math.floor(startMs / 1000));

        if (!this.isReady || !this.player || typeof this.player.loadVideoById !== 'function') {
            this.pendingPlay = { ytId, startMs };
            this.init();
            return;
        }

        try {
            this.syncVolume();
            this.player.loadVideoById({
                videoId: ytId,
                startSeconds: startSec
            });
            this.player.playVideo();
            this.isPlaying = true;
        } catch (e) {
            console.warn('[Jam YouTube] play error:', e);
        }
    }

    public resume() {
        if (!this.player || typeof this.player.playVideo !== 'function') return;
        try {
            this.syncVolume();
            this.player.playVideo();
            this.isPlaying = true;
        } catch {}
    }

    public pause() {
        if (!this.player || typeof this.player.pauseVideo !== 'function') return;
        try {
            this.player.pauseVideo();
            this.isPlaying = false;
        } catch {}
    }

    public stop() {
        this.currentYtId = null;
        this.isPlaying = false;
        if (!this.player) return;
        try {
            if (typeof this.player.stopVideo === 'function') this.player.stopVideo();
        } catch {}
    }

    public seekTo(ms: number) {
        if (!this.player || typeof this.player.seekTo !== 'function') return;
        try {
            const sec = Math.max(0, ms / 1000);
            this.player.seekTo(sec, true);
            this.cachedCurrentMs = ms;
        } catch {}
    }

    public getStatus(): YouTubeEngineStatus {
        if (!this.player || !this.isReady) {
            return {
                currentMs: this.cachedCurrentMs,
                durationMs: this.cachedDurationMs,
                isPlaying: this.isPlaying,
                isReady: this.isReady,
                ytId: this.currentYtId
            };
        }

        try {
            if (typeof this.player.getCurrentTime === 'function') {
                const curSec = this.player.getCurrentTime() || 0;
                this.cachedCurrentMs = Math.round(curSec * 1000);
            }
            if (typeof this.player.getDuration === 'function') {
                const durSec = this.player.getDuration() || 0;
                if (durSec > 0) this.cachedDurationMs = Math.round(durSec * 1000);
            }
            if (typeof this.player.getPlayerState === 'function') {
                const state = this.player.getPlayerState();
                this.isPlaying = state === 1; // 1 = playing
            }
        } catch {}

        return {
            currentMs: this.cachedCurrentMs,
            durationMs: this.cachedDurationMs,
            isPlaying: this.isPlaying,
            isReady: this.isReady,
            ytId: this.currentYtId
        };
    }
}

export const ytEngine = new YouTubeEngine();
