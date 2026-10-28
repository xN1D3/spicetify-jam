// YouTube Virtual Audio Engine for Spicetify Jam
// Hybrid direct-iframe + postMessage + IFrame API with Error 153 referrer policy fixes

export interface YouTubeEngineStatus {
    currentMs: number;
    durationMs: number;
    isPlaying: boolean;
    isReady: boolean;
    ytId: string | null;
}

class YouTubeEngine {
    private iframe: HTMLIFrameElement | null = null;
    private player: any = null;
    private isReady = false;
    private currentYtId: string | null = null;
    private isPlaying = false;
    private cachedDurationMs = 0;
    private cachedCurrentMs = 0;
    public onTrackEnded: (() => void) | null = null;
    public onStateChange: ((isPlaying: boolean) => void) | null = null;

    constructor() {
        this.init();
    }

    private init() {
        if (typeof document === 'undefined') return;

        // 1. Ensure meta referrer is strict-origin-when-cross-origin so CEF doesn't strip HTTP referrers
        try {
            let meta = document.querySelector('meta[name="referrer"]') as HTMLMetaElement;
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = 'referrer';
                document.head.appendChild(meta);
            }
            meta.content = 'strict-origin-when-cross-origin';
        } catch {}

        // 2. Create or get offscreen container
        let container = document.getElementById('jam-yt-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'jam-yt-container';
            container.style.cssText = 'position:fixed;width:320px;height:240px;left:-9999px;top:-9999px;pointer-events:none;z-index:-9999;';
            document.body.appendChild(container);
        }

        // 3. Global message listener for postMessage events from YouTube iframe
        if (!(window as any).__jamYtMessageListenerAdded) {
            (window as any).__jamYtMessageListenerAdded = true;
            window.addEventListener('message', (event) => {
                try {
                    if (typeof event.data !== 'string') return;
                    const data = JSON.parse(event.data);
                    if (data.event === 'onStateChange') {
                        // 0 = ENDED, 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING
                        if (data.info === 1) {
                            this.isPlaying = true;
                            this.isReady = true;
                            this.syncVolume();
                            this.onStateChange?.(true);
                        } else if (data.info === 2) {
                            this.isPlaying = false;
                            this.onStateChange?.(false);
                        } else if (data.info === 0) {
                            this.isPlaying = false;
                            this.onStateChange?.(false);
                            this.onTrackEnded?.();
                        }
                    } else if (data.event === 'infoDelivery' && data.info) {
                        if (data.info.currentTime !== undefined) {
                            this.cachedCurrentMs = Math.round(data.info.currentTime * 1000);
                        }
                        if (data.info.duration !== undefined && data.info.duration > 0) {
                            this.cachedDurationMs = Math.round(data.info.duration * 1000);
                        }
                        if (data.info.playerState !== undefined) {
                            this.isPlaying = data.info.playerState === 1;
                        }
                    } else if (data.event === 'onError') {
                        console.warn('[Jam YouTube] Error event from iframe:', data);
                        const code = data.info || '';
                        try {
                            if (typeof (Spicetify as any)?.showNotification === 'function') {
                                (Spicetify as any).showNotification(`⚠️ YouTube Error ${code} (Owner blocked embed or restricted)`, true);
                            }
                        } catch {}
                    }
                } catch {}
            });
        }

        // 4. Audio unlock listener on user click
        const unlockAudio = () => {
            if (this.isPlaying && this.currentYtId) {
                this.resume();
                this.syncVolume();
            }
        };
        document.addEventListener('click', unlockAudio, { passive: true });

        // 5. Load official API script in background for secondary control
        if (!(window as any).YT) {
            const existingScript = document.getElementById('jam-yt-api-script');
            if (!existingScript) {
                const script = document.createElement('script');
                script.id = 'jam-yt-api-script';
                script.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(script);
            }
        }
    }

    private sendPostMessage(func: string, args: any[] = []) {
        try {
            if (!this.iframe || !this.iframe.contentWindow) return;
            this.iframe.contentWindow.postMessage(JSON.stringify({
                event: 'command',
                func,
                args
            }), '*');
        } catch {}
    }

    public syncVolume() {
        try {
            const vol = typeof (Spicetify as any).Player?.getVolume === 'function'
                ? (Spicetify as any).Player.getVolume()
                : 1;
            const pct = Math.max(0, Math.min(100, Math.round(vol * 100)));
            
            // Send via postMessage directly
            this.sendPostMessage('setVolume', [pct]);
            if (pct === 0) {
                this.sendPostMessage('mute');
            } else {
                this.sendPostMessage('unMute');
            }

            // Also send via YT.Player if bound
            if (this.player && typeof this.player.setVolume === 'function') {
                this.player.setVolume(pct);
                if (pct === 0 && typeof this.player.mute === 'function') this.player.mute();
                else if (pct > 0 && typeof this.player.unMute === 'function') this.player.unMute();
            }
        } catch {}
    }

    public play(ytId: string, startMs: number = 0) {
        this.currentYtId = ytId;
        this.isPlaying = true;
        this.cachedCurrentMs = startMs;
        const startSec = Math.max(0, Math.floor(startMs / 1000));

        let container = document.getElementById('jam-yt-container');
        if (!container) {
            this.init();
            container = document.getElementById('jam-yt-container');
        }
        if (!container) return;

        // Check if iframe exists
        let iframe = document.getElementById('jam-yt-iframe') as HTMLIFrameElement;
        // Use youtube-nocookie and explicit widget_referrer to fix Error 153
        const targetSrc = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&enablejsapi=1&start=${startSec}&playsinline=1&widget_referrer=https://open.spotify.com`;

        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'jam-yt-iframe';
            iframe.style.cssText = 'width:320px;height:240px;border:none;';
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            (iframe as any).referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            iframe.src = targetSrc;
            container.innerHTML = '';
            container.appendChild(iframe);
            this.iframe = iframe;
        } else {
            this.iframe = iframe;
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            (iframe as any).referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            
            // If already loaded same video, just seek and play
            if (iframe.src.includes(`/embed/${ytId}`)) {
                this.seekTo(startMs);
                this.resume();
            } else {
                // Different video, reload iframe src directly
                iframe.src = targetSrc;
            }
        }

        // Try to bind YT.Player for richer API if YT script is ready
        try {
            const YT = (window as any).YT;
            if (YT && YT.Player && !this.player) {
                this.player = new YT.Player('jam-yt-iframe', {
                    events: {
                        onReady: () => {
                            this.isReady = true;
                            this.syncVolume();
                        },
                        onStateChange: (event: any) => {
                            if (event.data === 0) {
                                this.isPlaying = false;
                                this.onStateChange?.(false);
                                this.onTrackEnded?.();
                            }
                        },
                        onError: (err: any) => {
                            console.warn('[Jam YouTube] YT.Player error:', err);
                            const code = err.data || '';
                            try {
                                if (typeof (Spicetify as any)?.showNotification === 'function') {
                                    (Spicetify as any).showNotification(`⚠️ YouTube Error ${code} (Blocked or restricted)`, true);
                                }
                            } catch {}
                        }
                    }
                });
            }
        } catch {}

        // Schedule volume syncing and unmute after iframe starts loading
        this.syncVolume();
        setTimeout(() => this.syncVolume(), 400);
        setTimeout(() => this.syncVolume(), 1200);
        setTimeout(() => this.syncVolume(), 2500);

        try {
            if (typeof (Spicetify as any)?.showNotification === 'function') {
                (Spicetify as any).showNotification(`▶️ Playing YouTube: ${ytId}`);
            }
        } catch {}
    }

    public resume() {
        this.isPlaying = true;
        this.sendPostMessage('playVideo');
        this.sendPostMessage('unMute');
        this.syncVolume();
        if (this.player && typeof this.player.playVideo === 'function') {
            try { this.player.playVideo(); } catch {}
        }
    }

    public pause() {
        this.isPlaying = false;
        this.sendPostMessage('pauseVideo');
        if (this.player && typeof this.player.pauseVideo === 'function') {
            try { this.player.pauseVideo(); } catch {}
        }
    }

    public stop() {
        this.currentYtId = null;
        this.isPlaying = false;
        this.sendPostMessage('stopVideo');
        if (this.iframe) {
            this.iframe.src = 'about:blank';
        }
        if (this.player && typeof this.player.stopVideo === 'function') {
            try { this.player.stopVideo(); } catch {}
        }
    }

    public seekTo(ms: number) {
        const sec = Math.max(0, ms / 1000);
        this.cachedCurrentMs = ms;
        this.sendPostMessage('seekTo', [sec, true]);
        if (this.player && typeof this.player.seekTo === 'function') {
            try { this.player.seekTo(sec, true); } catch {}
        }
    }

    public getStatus(): YouTubeEngineStatus {
        if (this.player) {
            try {
                if (typeof this.player.getCurrentTime === 'function') {
                    const curSec = this.player.getCurrentTime() || 0;
                    if (curSec > 0) this.cachedCurrentMs = Math.round(curSec * 1000);
                }
                if (typeof this.player.getDuration === 'function') {
                    const durSec = this.player.getDuration() || 0;
                    if (durSec > 0) this.cachedDurationMs = Math.round(durSec * 1000);
                }
                if (typeof this.player.getPlayerState === 'function') {
                    const state = this.player.getPlayerState();
                    this.isPlaying = state === 1;
                }
            } catch {}
        }

        return {
            currentMs: this.cachedCurrentMs,
            durationMs: this.cachedDurationMs,
            isPlaying: this.isPlaying,
            isReady: this.isReady || (this.iframe !== null),
            ytId: this.currentYtId
        };
    }
}

export const ytEngine = new YouTubeEngine();
