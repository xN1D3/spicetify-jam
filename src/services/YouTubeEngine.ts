// YouTube Virtual Audio Engine for Spicetify Jam
// Dual-Mode: Direct Audio Stream (0% Ads) + Robust IFrame PiP Fallback with Live Time Sync

export interface YouTubeEngineStatus {
    currentMs: number;
    durationMs: number;
    isPlaying: boolean;
    isReady: boolean;
    ytId: string | null;
    mode: 'direct' | 'iframe' | 'none';
}

class YouTubeEngine {
    private audioElement: HTMLAudioElement | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private player: any = null;
    private mode: 'direct' | 'iframe' | 'none' = 'none';

    private isReady = false;
    private currentYtId: string | null = null;
    private isPlaying = false;
    private cachedDurationMs = 0;
    private cachedCurrentMs = 0;
    private lastTickTime = 0;

    // Cache visitorData for Innertube
    private visitorData: string | null = null;
    private visitorDataExpiresAt = 0;

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

        // 2. Pre-create HTML5 audio element
        this.getOrCreateAudioElement();

        // 3. Create or get floating PiP container
        let container = document.getElementById('jam-yt-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'jam-yt-container';
            container.className = 'jam-yt-pip-container';
            container.innerHTML = `
                <div class="jam-yt-pip-header">
                    <div class="jam-yt-pip-title" id="jam-yt-pip-title">
                        <span style="color:#ff0000;font-size:12px;">▶</span> YouTube Jam Player
                    </div>
                    <div class="jam-yt-pip-actions">
                        <button class="jam-yt-pip-btn" id="jam-yt-pip-min" title="Minimize / Expand">_</button>
                        <button class="jam-yt-pip-btn" id="jam-yt-pip-close" title="Hide video">✕</button>
                    </div>
                </div>
                <div class="jam-yt-pip-body" id="jam-yt-pip-body"></div>
            `;
            document.body.appendChild(container);

            const minBtn = container.querySelector('#jam-yt-pip-min');
            const closeBtn = container.querySelector('#jam-yt-pip-close');
            minBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                container?.classList.toggle('minimized');
            });
            closeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                container?.classList.add('minimized');
            });
        }

        // 4. Attach window message listener for YouTube postMessage events
        if ((window as any).__jamYtMsgHandler) {
            window.removeEventListener('message', (window as any).__jamYtMsgHandler);
        }
        const msgHandler = (event: MessageEvent) => {
            try {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch { return; }
                }
                if (!data || typeof data !== 'object') return;

                if (data.event === 'onStateChange') {
                    // 0 = ENDED, 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING
                    if (data.info === 1) {
                        this.isPlaying = true;
                        this.isReady = true;
                        this.lastTickTime = performance.now();
                        this.syncVolume();
                        this.onStateChange?.(true);
                    } else if (data.info === 2) {
                        this.isPlaying = false;
                        this.lastTickTime = 0;
                        this.onStateChange?.(false);
                    } else if (data.info === 0) {
                        this.isPlaying = false;
                        this.lastTickTime = 0;
                        this.onStateChange?.(false);
                        this.onTrackEnded?.();
                    }
                } else if (data.event === 'infoDelivery' && data.info) {
                    if (data.info.currentTime !== undefined && data.info.currentTime >= 0) {
                        this.cachedCurrentMs = Math.round(data.info.currentTime * 1000);
                        this.lastTickTime = performance.now();
                    }
                    if (data.info.duration !== undefined && data.info.duration > 0) {
                        this.cachedDurationMs = Math.round(data.info.duration * 1000);
                    }
                    if (data.info.playerState !== undefined) {
                        this.isPlaying = data.info.playerState === 1;
                        if (this.isPlaying && this.lastTickTime === 0) {
                            this.lastTickTime = performance.now();
                        }
                    }
                }
            } catch {}
        };
        (window as any).__jamYtMsgHandler = msgHandler;
        window.addEventListener('message', msgHandler);

        // 5. Audio unlock listener on user click
        const unlockAudio = () => {
            if (this.isPlaying && this.currentYtId) {
                this.resume();
                this.syncVolume();
            }
        };
        document.addEventListener('click', unlockAudio, { passive: true });

        // 6. Load official YT API script in background for secondary binding
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

    private getOrCreateAudioElement(): HTMLAudioElement {
        if (!this.audioElement) {
            this.audioElement = new Audio();
            this.audioElement.id = 'jam-yt-audio';
            this.audioElement.preload = 'auto';

            this.audioElement.addEventListener('play', () => {
                if (this.mode === 'direct') {
                    this.isPlaying = true;
                    this.lastTickTime = performance.now();
                    this.onStateChange?.(true);
                }
            });

            this.audioElement.addEventListener('pause', () => {
                if (this.mode === 'direct') {
                    this.isPlaying = false;
                    this.lastTickTime = 0;
                    this.onStateChange?.(false);
                }
            });

            this.audioElement.addEventListener('ended', () => {
                if (this.mode === 'direct') {
                    this.isPlaying = false;
                    this.lastTickTime = 0;
                    this.onStateChange?.(false);
                    this.onTrackEnded?.();
                }
            });

            this.audioElement.addEventListener('timeupdate', () => {
                if (this.mode === 'direct' && this.audioElement) {
                    this.cachedCurrentMs = Math.round(this.audioElement.currentTime * 1000);
                    this.lastTickTime = performance.now();
                    if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
                        this.cachedDurationMs = Math.round(this.audioElement.duration * 1000);
                    }
                }
            });

            this.audioElement.addEventListener('error', (e) => {
                console.warn('[Jam YouTube] HTML5 Audio error, falling back to Iframe player:', e);
                if (this.mode === 'direct' && this.currentYtId) {
                    this.playIframe(this.currentYtId, this.cachedCurrentMs);
                }
            });
        }
        return this.audioElement;
    }

    // ── Direct Audio Stream Resolver (VisionOS Innertube) ──
    private async getVisitorData(): Promise<string | null> {
        if (this.visitorData && Date.now() < this.visitorDataExpiresAt) {
            return this.visitorData;
        }
        try {
            const res = await fetch('https://www.youtube.com/sw.js_data');
            if (!res.ok) return null;
            const text = await res.text();
            const json = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
            const v = json?.[0]?.[2]?.[0]?.[0]?.[13];
            if (typeof v === 'string' && v.length > 50) {
                this.visitorData = v;
                this.visitorDataExpiresAt = Date.now() + 3600 * 1000;
                return v;
            }
        } catch {
            // Browser CORS might block sw.js_data on https://open.spotify.com
        }
        return null;
    }

    private async resolveDirectAudio(ytId: string): Promise<{ url: string; durationMs: number } | null> {
        // 1. Primary: Local Jam Audio Bridge (Zero Ads, Pure High-Bitrate GoogleVideo Audio)
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(`http://127.0.0.1:8765/audio?id=${encodeURIComponent(ytId)}`, {
                signal: controller.signal
            });
            clearTimeout(timer);
            if (res.ok) {
                const data = await res.json();
                if (data && data.url) {
                    console.log('[Jam YouTube] Direct audio stream active via Local Bridge (0% Ads):', ytId);
                    return {
                        url: data.url,
                        durationMs: data.durationMs || 0
                    };
                }
            }
        } catch (e) {
            console.warn('[Jam YouTube] Local bridge (127.0.0.1:8765) unreachable, trying fallback:', e);
        }

        // 2. Secondary: Direct browser Innertube attempt (if bridge not running)
        try {
            const visitorData = await this.getVisitorData();
            if (visitorData) {
                const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-YouTube-Client-Name': '101',
                        'X-YouTube-Client-Version': '1.02',
                        'X-Goog-Visitor-Id': visitorData
                    },
                    body: JSON.stringify({
                        context: {
                            client: {
                                clientName: 'VISIONOS',
                                clientVersion: '1.02',
                                deviceMake: 'Apple',
                                deviceModel: 'RealityDevice17,1',
                                osName: 'visionOS',
                                osVersion: '26.5.23O471',
                                hl: 'en',
                                gl: 'US',
                                utcOffsetMinutes: 0,
                                visitorData
                            }
                        },
                        videoId: ytId,
                        contentCheckOk: true,
                        racyCheckOk: true,
                        playbackContext: {
                            contentPlaybackContext: {
                                html5Preference: 'HTML5_PREF_WANTS'
                            }
                        }
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.playabilityStatus?.status === 'OK') {
                        const formats = data.streamingData?.adaptiveFormats;
                        if (Array.isArray(formats)) {
                            const audios = formats.filter((f: any) => f.mimeType && f.mimeType.startsWith('audio/') && f.url);
                            if (audios.length) {
                                const best = audios.find((a: any) => a.itag === 140)
                                          || audios.find((a: any) => a.itag === 251)
                                          || audios[0];
                                const dur = parseInt(best.approxDurationMs || '0', 10);
                                return {
                                    url: best.url,
                                    durationMs: dur > 0 ? dur : 0
                                };
                            }
                        }
                    }
                }
            }
        } catch {
            // Browser CORS or network error
        }

        return null;
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

            if (this.audioElement) {
                this.audioElement.volume = Math.max(0, Math.min(1, vol));
            }

            if (this.mode === 'iframe') {
                const pct = Math.max(0, Math.min(100, Math.round(vol * 100)));
                this.sendPostMessage('setVolume', [pct]);
                if (pct === 0) this.sendPostMessage('mute');
                else this.sendPostMessage('unMute');

                if (this.player && typeof this.player.setVolume === 'function') {
                    this.player.setVolume(pct);
                    if (pct === 0 && typeof this.player.mute === 'function') this.player.mute();
                    else if (pct > 0 && typeof this.player.unMute === 'function') this.player.unMute();
                }
            }
        } catch {}
    }

    public async play(ytId: string, startMs: number = 0) {
        this.currentYtId = ytId;
        this.cachedCurrentMs = startMs;
        this.lastTickTime = performance.now();
        this.isPlaying = true;

        if (this.mode === 'direct' && this.audioElement && this.currentYtId === ytId && this.audioElement.src) {
            this.seekTo(startMs);
            this.resume();
            return;
        }

        this.stopCurrentMedia();

        // 1. Try Direct Audio Stream (Ad-Free)
        const direct = await this.resolveDirectAudio(ytId);
        if (direct && direct.url) {
            console.log('[Jam YouTube] Direct audio stream active (Ad-Free)');
            this.mode = 'direct';
            this.isReady = true;
            if (direct.durationMs > 0) this.cachedDurationMs = direct.durationMs;

            const audio = this.getOrCreateAudioElement();
            audio.src = direct.url;
            this.syncVolume();

            if (startMs > 0) {
                const onLoaded = () => {
                    try { audio.currentTime = Math.max(0, startMs / 1000); } catch {}
                    audio.removeEventListener('loadedmetadata', onLoaded);
                };
                audio.addEventListener('loadedmetadata', onLoaded);
            } else {
                audio.currentTime = 0;
            }

            this.updatePiPForDirect();

            try {
                await audio.play();
                this.isPlaying = true;
                this.lastTickTime = performance.now();
                this.onStateChange?.(true);
                return;
            } catch (err) {
                console.warn('[Jam YouTube] Waiting for user click to start audio:', err);
                this.isPlaying = true;
                return;
            }
        }

        // 2. Fallback to IFrame Player (with real-time progress & duration sync)
        console.warn('[Jam YouTube] Playing via IFrame fallback (Make sure Start-Jam-Audio.bat is running for 0% ads)');
        try {
            (Spicetify as any)?.showNotification?.('⚠️ โหมดสำรอง: เปิด Start-Jam-Audio.bat เพื่อฟัง YouTube แบบไม่มีโฆษณา');
        } catch {}
        this.playIframe(ytId, startMs);
    }

    private updatePiPForDirect() {
        const container = document.getElementById('jam-yt-container');
        const body = document.getElementById('jam-yt-pip-body');
        const title = document.getElementById('jam-yt-pip-title');

        if (container) {
            container.classList.add('active');
            container.classList.add('minimized');
        }

        if (title) {
            title.innerHTML = `<span style="color:#1ed760;font-size:12px;">⚡</span> Ad-Free Audio Stream`;
        }

        if (body) {
            body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:linear-gradient(135deg, #181818 0%, #121212 100%);color:#fff;font-family:sans-serif;padding:16px;box-sizing:border-box;text-align:center;">
                    <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(30,215,96,0.15);border:1px solid rgba(30,215,96,0.35);color:#1ed760;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-bottom:8px;">
                        ⚡ Direct Audio Stream
                    </div>
                    <div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:4px;">Ad-Free Playback Active</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.5);">Zero ads • Studio audio • Instant sync</div>
                </div>
            `;
        }
    }

    private playIframe(ytId: string, startMs: number = 0) {
        this.mode = 'iframe';
        this.cachedCurrentMs = startMs;
        this.lastTickTime = performance.now();
        this.isPlaying = true;
        const startSec = Math.max(0, Math.floor(startMs / 1000));

        let container = document.getElementById('jam-yt-container');
        if (container) {
            container.classList.add('active');
        }

        const title = document.getElementById('jam-yt-pip-title');
        if (title) {
            title.innerHTML = `<span style="color:#ff0000;font-size:12px;">▶</span> YouTube Jam Player`;
        }

        const body = document.getElementById('jam-yt-pip-body');
        if (!body) return;

        let iframe = document.getElementById('jam-yt-iframe') as HTMLIFrameElement;
        const targetSrc = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&enablejsapi=1&start=${startSec}&playsinline=1&widget_referrer=https://open.spotify.com`;

        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'jam-yt-iframe';
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            (iframe as any).referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            iframe.src = targetSrc;
            body.innerHTML = '';
            body.appendChild(iframe);
            this.iframe = iframe;
        } else {
            this.iframe = iframe;
            if (this.currentYtId === ytId && iframe.src.includes(`/embed/${ytId}`)) {
                this.seekTo(startMs);
                this.resume();
                return;
            } else {
                iframe.src = targetSrc;
            }
        }

        // Try to bind YT.Player for richer state & time extraction
        try {
            const YT = (window as any).YT;
            if (YT && YT.Player) {
                this.player = new YT.Player('jam-yt-iframe', {
                    events: {
                        onReady: () => {
                            this.isReady = true;
                            this.syncVolume();
                        },
                        onStateChange: (event: any) => {
                            if (event.data === 1) {
                                this.isPlaying = true;
                                this.lastTickTime = performance.now();
                                this.onStateChange?.(true);
                            } else if (event.data === 2) {
                                this.isPlaying = false;
                                this.lastTickTime = 0;
                                this.onStateChange?.(false);
                            } else if (event.data === 0) {
                                this.isPlaying = false;
                                this.lastTickTime = 0;
                                this.onStateChange?.(false);
                                this.onTrackEnded?.();
                            }
                        }
                    }
                });
            }
        } catch {}

        // Send listening handshake so YouTube iframe streams currentTime & duration updates
        setTimeout(() => {
            this.sendPostMessage('listening');
            this.syncVolume();
        }, 500);
        setTimeout(() => {
            this.sendPostMessage('listening');
            this.syncVolume();
        }, 1500);
        setTimeout(() => {
            this.sendPostMessage('listening');
            this.syncVolume();
        }, 3000);
    }

    private stopCurrentMedia() {
        if (this.audioElement) {
            try {
                this.audioElement.pause();
                this.audioElement.removeAttribute('src');
                this.audioElement.load();
            } catch {}
        }
        if (this.iframe) {
            try {
                this.sendPostMessage('stopVideo');
                this.iframe.src = 'about:blank';
                this.iframe.remove();
            } catch {}
            this.iframe = null;
            this.player = null;
        }
    }

    public resume() {
        this.isPlaying = true;
        this.lastTickTime = performance.now();
        if (this.mode === 'direct' && this.audioElement) {
            this.audioElement.play().catch(() => {});
        } else if (this.mode === 'iframe') {
            this.sendPostMessage('playVideo');
            this.sendPostMessage('unMute');
            if (this.player && typeof this.player.playVideo === 'function') {
                try { this.player.playVideo(); } catch {}
            }
        }
        this.syncVolume();
    }

    public pause() {
        this.isPlaying = false;
        this.lastTickTime = 0;
        if (this.mode === 'direct' && this.audioElement) {
            this.audioElement.pause();
        } else if (this.mode === 'iframe') {
            this.sendPostMessage('pauseVideo');
            if (this.player && typeof this.player.pauseVideo === 'function') {
                try { this.player.pauseVideo(); } catch {}
            }
        }
    }

    public stop() {
        this.currentYtId = null;
        this.isPlaying = false;
        this.mode = 'none';
        this.lastTickTime = 0;
        this.stopCurrentMedia();

        const container = document.getElementById('jam-yt-container');
        if (container) {
            container.classList.remove('active');
            container.classList.remove('minimized');
        }
    }

    public seekTo(ms: number) {
        this.cachedCurrentMs = ms;
        this.lastTickTime = performance.now();
        const sec = Math.max(0, ms / 1000);

        if (this.mode === 'direct' && this.audioElement) {
            this.audioElement.currentTime = sec;
        } else if (this.mode === 'iframe') {
            this.sendPostMessage('seekTo', [sec, true]);
            if (this.player && typeof this.player.seekTo === 'function') {
                try { this.player.seekTo(sec, true); } catch {}
            }
        }
    }

    public getStatus(): YouTubeEngineStatus {
        if (this.mode === 'direct' && this.audioElement) {
            if (this.audioElement.currentTime !== undefined) {
                this.cachedCurrentMs = Math.round(this.audioElement.currentTime * 1000);
            }
            if (this.audioElement.duration && !isNaN(this.audioElement.duration)) {
                this.cachedDurationMs = Math.round(this.audioElement.duration * 1000);
            }
            this.isPlaying = !this.audioElement.paused && !this.audioElement.ended;
        } else if (this.mode === 'iframe') {
            // Check YT.Player if bound
            if (this.player) {
                try {
                    if (typeof this.player.getCurrentTime === 'function') {
                        const cur = this.player.getCurrentTime();
                        if (typeof cur === 'number' && cur > 0) {
                            this.cachedCurrentMs = Math.round(cur * 1000);
                            this.lastTickTime = performance.now();
                        }
                    }
                    if (typeof this.player.getDuration === 'function') {
                        const dur = this.player.getDuration();
                        if (typeof dur === 'number' && dur > 0) {
                            this.cachedDurationMs = Math.round(dur * 1000);
                        }
                    }
                    if (typeof this.player.getPlayerState === 'function') {
                        const st = this.player.getPlayerState();
                        this.isPlaying = st === 1;
                    }
                } catch {}
            }

            // Smooth local clock interpolation between postMessage frames
            if (this.isPlaying && this.lastTickTime > 0) {
                const now = performance.now();
                const delta = now - this.lastTickTime;
                if (delta > 0 && delta < 2000) {
                    this.cachedCurrentMs += Math.round(delta);
                }
                this.lastTickTime = now;
            }
        }

        return {
            currentMs: this.cachedCurrentMs,
            durationMs: this.cachedDurationMs,
            isPlaying: this.isPlaying,
            isReady: this.isReady || (this.mode === 'direct' && !!this.audioElement?.src) || (this.iframe !== null),
            ytId: this.currentYtId,
            mode: this.mode
        };
    }
}

export const ytEngine = new YouTubeEngine();
