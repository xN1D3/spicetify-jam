
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';

interface TrackInfo { title: string; artist: string; artUrl: string; uri?: string; uid?: string; isManual?: boolean; isCustom?: boolean; addedBy?: { name: string; image: string }; }
export interface Member { id: string; name: string; isHost?: boolean; image?: string; status?: 'active' | 'reconnecting' | 'disconnected'; }
export interface LastSessionInfo {
    role: 'host' | 'guest';
    jamId: string;
    hostName?: string;
}

interface JamState {
    isHost: boolean; jamId: string; members: Member[]; connected: boolean; error: string | null;
    nowPlaying: TrackInfo | null; hostName: string; queue: TrackInfo[];
    guestControls: boolean; guestCreateSong: boolean; isPlaying: boolean; progress: number; duration: number; ping: number;
    updateAvailable: boolean;
    reconnecting: boolean;
    savedHostId: string | null;
    savedSession: LastSessionInfo | null;
    resumeSession: () => Promise<void>;
    startJam: (requestedId?: string) => Promise<void>; joinJam: (id: string, name?: string) => Promise<void>;
    leaveJam: (clearSavedSession?: boolean) => void; addToQueue: (uri: string | string[], sender?: { name: string; image: string }, preloadedMeta?: TrackInfo) => void; removeFromQueue: (uri: string, uid?: string) => void;
    addCustomTrack: (title: string, artist?: string) => void;
    moveInQueue: (from: number, to: number) => void; requestSync: () => void;
    jumpToTrack: (uri: string) => void; seekTo: (ms: number) => void;
    kickMember: (id: string) => void; toggleGuestControls: () => void; toggleGuestCreateSong: () => void;
    play: () => void; pause: () => void; next: () => void; prev: () => void;
}

// WebRTC ICE servers: Fast STUN + OpenRelay + Private VPS Relay Fallback
const _ice = () => [
    // 1. Direct P2P STUN Hole-punching (Primary - zero relay overhead)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.relay.metered.ca:80' },

    // 2. OpenRelay Fallback
    { urls: 'turn:openrelay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },

    // 3. Dedicated VPS Fallback Relay (Resource-capped & lightweight)
    { urls: 'turn:137.23.45.53:3478?transport=udp', username: 'spicetifyjam', credential: 'jamrelaypass2026' },
    { urls: 'turn:137.23.45.53:3478?transport=tcp', username: 'spicetifyjam', credential: 'jamrelaypass2026' },
];
const PEER_CONFIG = { config: { iceServers: _ice(), iceCandidatePoolSize: 10 }, debug: 0 };

const fmtImg = (u?: string): string => {
    if (!u) return '';
    if (u.startsWith('https://')) return u;
    if (u.startsWith('spotify:image:')) return `https://i.scdn.co/image/${u.slice(14)}`;
    return '';
};

const fetchUserAsync = async (): Promise<{ name: string; image: string }> => {
    let name = '';
    let image = '';

    try {
        const user = await (Spicetify as any).Platform?.UserAPI?.getUser();
        if (user) {
            if (user.displayName) name = user.displayName;
            image = fmtImg(user.images?.[0]?.url || user.images?.[0] || user.imageUrl || user.avatar || '');
        }
    } catch {}

    if (!name || !image) {
        try {
            const res = await (Spicetify as any).CosmosAsync.get('sp://identity/v1/profile');
            if (res) {
                if (!name) name = res.displayName || res.name || '';
                if (!image) image = fmtImg(res.imageUrl || res.image || res.images?.[0]?.url || '');
            }
        } catch {}
    }

    if (!image) {
        const domImg = document.querySelector<HTMLImageElement>(
            'button[data-testid="user-widget-link"] img, [data-testid="user-widget-avatar"] img, .main-userWidget-avatar img, figure[data-testid="user-widget-avatar"] img'
        );
        if (domImg?.src) image = domImg.src;
    }

    if (!name) {
        name =
            (Spicetify as any).Username ||
            document.querySelector('[data-testid="user-widget-name"]')?.textContent?.trim() ||
            document.querySelector('.main-userWidget-displayName')?.textContent?.trim() ||
            'Host';
    }

    return { name, image };
};

const trackMetaCache = new Map<string, TrackInfo>();

const getAccessToken = async (): Promise<string | null> => {
    try {
        const state = (Spicetify as any).Platform?.AuthorizationAPI?.getState?.();
        if (state?.token?.accessToken) return state.token.accessToken;
    } catch {}
    try {
        const token = await (Spicetify as any).Platform?.AuthorizationAPI?.getAccessToken?.();
        if (typeof token === 'string') return token;
        if (token?.accessToken) return token.accessToken;
    } catch {}
    try {
        const token = await (Spicetify as any).Platform?.Session?.getAccessToken?.();
        if (typeof token === 'string') return token;
        if (token?.accessToken) return token.accessToken;
    } catch {}
    try {
        const res = await (Spicetify as any).CosmosAsync?.get?.('sp://identity/v1/token');
        if (res?.accessToken) return res.accessToken;
    } catch {}
    return null;
};

const getTrack = (): TrackInfo | null => {
    const t = Spicetify.Player.data?.item;
    if (!t) return null;
    const meta = t.metadata || {};
    const res: TrackInfo = {
        title: t.name || meta.title || 'Unknown',
        artist: t.artists?.[0]?.name || meta.artist_name || 'Unknown',
        artUrl: fmtImg(meta.image_xlarge_url || meta.image_large_url || meta.image_url || t.images?.[0]?.url),
        uri: t.uri,
        uid: t.uid
    };
    if (res.uri && res.title && res.title !== 'Unknown' && res.title !== 'Added Track') {
        trackMetaCache.set(res.uri, res);
    }
    return res;
};

const extractTrack = (t: any, isManual = false): TrackInfo => {
    if (!t) return { title: '?', artist: '?', artUrl: '', uri: '', uid: '' };
    // If already extracted, return it with isManual preserved
    if (typeof t.title === 'string' && typeof t.artist === 'string' && t.uri) {
        if (t.title !== '?' && t.title !== 'Added Track') {
            trackMetaCache.set(t.uri, t);
        }
        return {
            title: t.title,
            artist: t.artist,
            artUrl: t.artUrl || '',
            uri: t.uri,
            uid: t.uid || '',
            isManual: t.isManual !== undefined ? t.isManual : isManual,
            addedBy: t.addedBy
        };
    }
    const data = t?.contextTrack || t?.track || t || {};
    const meta = data?.metadata || t?.metadata || {};
    let title = data.name || meta.name || meta.title || t.name || t.title || '?';
    let artist = (data.artists?.[0]?.name) || meta.artist_name || meta.album_artist || t.artist_name || t.artist || '?';
    let artUrl = fmtImg(meta.image_xlarge_url || meta.image_large_url || meta.image_url || data.album?.images?.[0]?.url || t.imageUrl || meta.thumbnail_url || t.artUrl);
    const uri = data.uri || t.uri || '';
    const uid = data.uid || t.uid || '';

    if (uri && (title === '?' || artist === '?') && trackMetaCache.has(uri)) {
        const cached = trackMetaCache.get(uri)!;
        if (title === '?' && cached.title && cached.title !== '?') title = cached.title;
        if (artist === '?' && cached.artist && cached.artist !== '?') artist = cached.artist;
        if (!artUrl && cached.artUrl) artUrl = cached.artUrl;
    }

    const res: TrackInfo = { title, artist, artUrl, uri, uid, isManual };
    if (uri && title !== '?' && title !== 'Added Track') {
        trackMetaCache.set(uri, res);
    }
    return res;
};

const getTrackDetails = async (uri: string): Promise<TrackInfo> => {
    if (trackMetaCache.has(uri)) {
        const cached = trackMetaCache.get(uri)!;
        if (cached.title && cached.title !== 'Added Track' && cached.title !== '?') {
            return { ...cached, isManual: true };
        }
    }

    const id = uri.replace('spotify:track:', '').split('?')[0];

    // 1. Try Spotify GraphQL decorateContextTracks (Native internal, ultra fast & has full metadata)
    try {
        const def = (Spicetify as any).GraphQL?.Definitions?.decorateContextTracks;
        if (def && (Spicetify as any).GraphQL?.Request) {
            const gqlRes = await (Spicetify as any).GraphQL.Request(def, { uris: [uri] });
            const list = Array.isArray(gqlRes)
                ? gqlRes
                : (gqlRes?.data?.decorateContextTracks || gqlRes?.data?.tracks || gqlRes?.tracks || []);
            const allTracks = list.flatMap((item: any) => item?.tracks || (item?.name ? [item] : []));
            const match = allTracks.find((t: any) => t?.uri === uri);
            if (match && match.name) {
                const artists = match.artists?.items?.map((a: any) => a.profile?.name || a.name).filter(Boolean).join(', ') ||
                                match.artists?.map?.((a: any) => a.name).filter(Boolean).join(', ') ||
                                'Unknown Artist';
                const art = fmtImg(match.albumOfTrack?.coverArt?.sources?.[0]?.url || match.album?.images?.[0]?.url);
                const info: TrackInfo = {
                    title: match.name,
                    artist: artists,
                    artUrl: art,
                    uri,
                    uid: '',
                    isManual: true
                };
                trackMetaCache.set(uri, info);
                return info;
            }
        }
    } catch {}

    // 2. Try Spotify Web API via fetch with Access Token
    try {
        const token = await getAccessToken();
        if (token) {
            const resp = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.name) {
                    const info: TrackInfo = {
                        title: data.name,
                        artist: data.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
                        artUrl: fmtImg(data.album?.images?.[0]?.url),
                        uri,
                        uid: '',
                        isManual: true
                    };
                    trackMetaCache.set(uri, info);
                    return info;
                }
            }
        }
    } catch {}

    // 3. Try CosmosAsync with Spotify Web API
    try {
        const res = await (Spicetify as any).CosmosAsync?.get(`https://api.spotify.com/v1/tracks/${id}`);
        if (res && res.name) {
            const info: TrackInfo = {
                title: res.name,
                artist: res.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
                artUrl: fmtImg(res.album?.images?.[0]?.url),
                uri,
                uid: '',
                isManual: true
            };
            trackMetaCache.set(uri, info);
            return info;
        }
    } catch {}

    // 4. Try Spotify GraphQL getTrackName & queryTrackArtists
    try {
        const nameDef = (Spicetify as any).GraphQL?.Definitions?.getTrackName;
        if (nameDef && (Spicetify as any).GraphQL?.Request) {
            const nameRes = await (Spicetify as any).GraphQL.Request(nameDef, { uri });
            const trackUnion = nameRes?.data?.trackUnion;
            if (trackUnion && trackUnion.name) {
                let artist = 'Unknown Artist';
                try {
                    const artDef = (Spicetify as any).GraphQL?.Definitions?.queryTrackArtists;
                    if (artDef) {
                        const artRes = await (Spicetify as any).GraphQL.Request(artDef, { trackUri: uri });
                        const artList = artRes?.data?.trackUnion?.artists?.items?.map((a: any) => a.profile?.name).filter(Boolean);
                        if (artList && artList.length > 0) artist = artList.join(', ');
                    }
                } catch {}
                const info: TrackInfo = {
                    title: trackUnion.name,
                    artist,
                    artUrl: '',
                    uri,
                    uid: '',
                    isManual: true
                };
                trackMetaCache.set(uri, info);
                return info;
            }
        }
    } catch {}

    // 5. Try Spotify public oEmbed (Zero auth, 100% reliable fallback)
    try {
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`);
        if (oembedRes.ok) {
            const oembed = await oembedRes.json();
            if (oembed && oembed.title) {
                const info: TrackInfo = {
                    title: oembed.title,
                    artist: 'Spotify Track',
                    artUrl: fmtImg(oembed.thumbnail_url),
                    uri,
                    uid: '',
                    isManual: true
                };
                trackMetaCache.set(uri, info);
                return info;
            }
        }
    } catch {}

    // 6. Try PlayerAPI queue search
    try {
        const q = await (Spicetify as any).Platform?.PlayerAPI?.getQueue?.();
        const allTracks = [...(q?.queued || []), ...(q?.nextTracks || []), ...(q?.nextUp || [])];
        const match = allTracks.find((t: any) => (t.uri === uri || t.track?.uri === uri || t.contextTrack?.uri === uri));
        if (match) {
            const extracted = extractTrack(match, true);
            if (extracted.title && extracted.title !== '?' && extracted.title !== 'Added Track') {
                trackMetaCache.set(uri, extracted);
                return extracted;
            }
        }
    } catch {}

    return { title: 'Added Track', artist: '', artUrl: '', uri, uid: '', isManual: true };
};

const getQueue = async (): Promise<TrackInfo[]> => {
    try {
        let tracks: any[] = [];

        // 1. Try Platform API (best for comprehensive manual + auto/context queue)
        try {
            const res = await (Spicetify as any).Platform?.PlayerAPI?.getQueue();
            if (res) {
                const queued = (res.queued || []).map((t: any) => extractTrack(t, true));
                const queuedUris = new Set(queued.map((t: any) => t.uri).filter(Boolean));
                const autoplayRaw = res.nextUp || res.autoplay || res.context || res.nextTracks || [];
                const autoplay = autoplayRaw
                    .map((t: any) => extractTrack(t, false))
                    .filter((t: TrackInfo) => t.uri && !queuedUris.has(t.uri));
                
                // Combine manual queue and non-duplicate auto queue
                if (queued.length > 0 || autoplay.length > 0) {
                    tracks = [...queued, ...autoplay];
                }
            }
        } catch {}

        // 2. Try Player data as fallback
        if (!tracks || tracks.length === 0) {
            if (Spicetify.Player?.data?.next_tracks) {
                tracks = (Spicetify.Player.data.next_tracks || []).map((t: any) => extractTrack(t, false));
            }
        }

        // 3. Last resort fallbacks
        if (!tracks || tracks.length === 0) {
            tracks = (Spicetify.Queue?.nextTracks || []).map((t: any) => extractTrack(t, false));
        }

        if (!tracks || tracks.length === 0) {
            try {
                const res = await (Spicetify as any).CosmosAsync.get('sp://player/v2/main/queue');
                tracks = (res?.next_tracks || res?.tracks || []).map((t: any) => extractTrack(t, false));
            } catch {}
        }

        if (!tracks || tracks.length === 0) return [];

        const seenUris = new Set<string>();
        return tracks.filter((t: TrackInfo) => {
            if (!t.uri || seenUris.has(t.uri)) return false;
            if ((t.title === '?' || t.title === 'Added Track') && trackMetaCache.has(t.uri)) {
                const cached = trackMetaCache.get(t.uri)!;
                if (cached.title && cached.title !== '?' && cached.title !== 'Added Track') {
                    t.title = cached.title;
                    t.artist = cached.artist || t.artist;
                    t.artUrl = cached.artUrl || t.artUrl;
                }
            }
            if (t.title === '?' && t.artist === '?') return false;
            seenUris.add(t.uri);
            return true;
        }).slice(0, 40);
    } catch { return []; }
};

// Atomically move a track in Spotify's native queue using Spotify's PlayerAPI.
// Avoids clearing or rewriting the entire queue when a user drags to reorder.
const moveTrackNative = async (movedTrack?: TrackInfo, targetTrack?: TrackInfo, isMovingDown = false): Promise<boolean> => {
    try {
        if (!movedTrack?.uri || !targetTrack?.uri) return false;
        if (movedTrack.isCustom || movedTrack.uri.startsWith('jam:fake:') || targetTrack.isCustom || targetTrack.uri.startsWith('jam:fake:')) {
            return true;
        }
        const playerApi = (Spicetify as any).Platform?.PlayerAPI;
        const originQueue = (Spicetify as any).Player?.origin?._queue;
        const reorderFn = playerApi?.reorderQueue ? playerApi.reorderQueue.bind(playerApi)
            : originQueue?.reorderQueue ? originQueue.reorderQueue.bind(originQueue)
            : null;

        if (reorderFn) {
            const item = { uid: movedTrack.uid || undefined, uri: movedTrack.uri };
            const target = { uid: targetTrack.uid || undefined, uri: targetTrack.uri };
            const position = isMovingDown ? { after: target } : { before: target };
            await reorderFn([item], position);
            return true;
        }
    } catch (e) {
        console.warn('[Spicetify Jam] Native reorderQueue failed, will fall back to rewrite', e);
    }
    return false;
};

// Rewrite Spotify's native manual queue to match `tracks`. Removals are
// per-track: a single batched removeFromQueue rejects wholesale when any entry
// (e.g. a context track that was never in the manual queue) can't be removed,
// and the re-add would then duplicate every track still in the queue.
const rewriteNativeQueue = async (tracks: TrackInfo[]) => {
    const uniqueTracks: TrackInfo[] = [];
    const seen = new Set<string>();
    for (const t of tracks) {
        if (t.uri && !t.isCustom && !t.uri.startsWith('jam:fake:') && !seen.has(t.uri)) {
            seen.add(t.uri);
            uniqueTracks.push(t);
        }
    }
    for (const t of uniqueTracks) {
        if (!t.uri) continue;
        try { await Spicetify.removeFromQueue([{ uri: t.uri, uid: t.uid } as any]); } catch {}
    }
    for (const t of uniqueTracks) {
        if (!t.uri) continue;
        try { await Spicetify.addToQueue([{ uri: t.uri }]); } catch {}
    }
};

const Ctx = createContext<JamState | undefined>(undefined);

export const JamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isHost, setIsHost] = useState(false);
    const [jamId, setJamId] = useState('');
    const [members, setMembers] = useState<Member[]>([]);
    const [connected, setConnected] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [savedSession, setSavedSession] = useState<LastSessionInfo | null>(() => {
        try {
            const raw = localStorage.getItem('jam_saved_session');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.jamId && Date.now() - Number(parsed.ts || 0) < 2 * 60 * 60 * 1000) {
                    return { role: parsed.role || 'host', jamId: parsed.jamId, hostName: parsed.hostName };
                }
            }
            const savedLegacy = localStorage.getItem('jam_saved_host_id');
            const tsLegacy = Number(localStorage.getItem('jam_saved_host_ts') || 0);
            if (savedLegacy && Date.now() - tsLegacy < 2 * 60 * 60 * 1000) {
                return { role: 'host', jamId: savedLegacy };
            }
        } catch {}
        return null;
    });
    const savedHostId = savedSession?.role === 'host' ? savedSession.jamId : null;
    const setSavedHostId = (id: string | null) => {
        if (id) {
            setSavedSession({ role: 'host', jamId: id });
        } else {
            setSavedSession(null);
        }
    };
    const [error, setError] = useState<string | null>(null);
    const [nowPlaying, setNowPlaying] = useState<TrackInfo | null>(null);
    const [hostName, setHostName] = useState('Host');
    const [queue, setQueue] = useState<TrackInfo[]>([]);
    const [guestControls, setGuestControls] = useState(false);
    const [guestCreateSong, setGuestCreateSong] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [ping, setPing] = useState(-1);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    const peerRef = useRef<Peer | null>(null);
    const conns = useRef<Map<string, DataConnection>>(new Map());
    const memberRegistry = useRef<Map<string, {name: string, image: string}>>(new Map());
    const cachedUser = useRef<{ name: string; image: string }>({ name: 'Listener', image: '' });
    const userPromise = useRef<Promise<{ name: string; image: string }> | null>(null);
    const refs = useRef({
        isHost: false,
        connected: false,
        reconnecting: false,
        guestControls: false,
        guestCreateSong: false,
        jamId: '',
        targetUri: null as string | null,
        ignoreNextSongChange: false,
        ignoreNextOnPP: false,
        isPlaying: false,
        forcingPause: false,
        lastProgress: 0,
        lastDuration: 0,
        remotePlayTs: 0,
        lastSyncRequestTs: 0,
        lastSyncAppliedTs: 0,
        sessionPinged: false,
        // Enhanced sync & micro-drift smoothing
        lastHostProgress: 0,
        lastHostProgressTs: 0,
        ping: 0,
        driftEma: 0,
        consecutiveDriftCount: 0,
    });
    // Tracks who added each URI to the queue (keyed by uri). Populated when the
    // host receives an ADD_Q from a guest; merged into the queue on every refresh.
    const addedByMap = useRef<Map<string, { name: string; image: string }>>(new Map());
    const cmdThrottle = useRef<Map<string, number>>(new Map());
    const lastHostMsg = useRef(0);
    const reconnectAttempt = useRef(0);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const songDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const ctxMenuItem = useRef<any>(null);
    const pendingQueueRestore = useRef<TrackInfo[]>([]);
    const pendingQueueRestoreTs = useRef<number>(0);
    const queueRef = useRef<TrackInfo[]>([]);
    // Timestamp of the last manual queue reorder — refreshQueue skips Spotify fetch
    // for 15 s after a drag-drop so the reordered queue is not immediately overwritten.
    const queueUserOrdered = useRef<number>(0);
    // Debounce timer for syncing reordered queue back to Spotify's native queue
    const reorderDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    // URIs removed from the Jam queue that can't be removed natively (context
    // tracks) — filtered out of refreshes and skipped if they start playing
    const removedUris = useRef<Set<string>>(new Set());
    // Stable ref to the latest onData — lets setupConn bind a single
    // permanent handler that always delegates to the current closure,
    // avoiding stale captures on existing WebRTC data connections.
    const onDataRef = useRef<((d: any, conn: DataConnection) => void) | null>(null);
    // Stable ref to the latest addToQueue — used by the ContextMenu item so
    // it doesn't need to be re-registered every time addToQueue changes.
    const addToQueueRef = useRef<((uris: string | string[], sender?: { name: string; image: string }, preloadedMeta?: TrackInfo) => void) | null>(null);
    const triggerGuestReconnectRef = useRef<((hostId: string) => void) | null>(null);
    const activeGuestConn = useRef<DataConnection | null>(null);
    const pendingGuestConn = useRef<DataConnection | null>(null);

    useEffect(() => { queueRef.current = queue; }, [queue]);

    useEffect(() => { refs.current.isHost = isHost; }, [isHost]);
    useEffect(() => { refs.current.connected = connected; }, [connected]);
    useEffect(() => { refs.current.reconnecting = reconnecting; }, [reconnecting]);

    // Pre-fetch the real Spotify user as soon as the provider mounts
    useEffect(() => {
        userPromise.current = fetchUserAsync();
        userPromise.current.then(u => { cachedUser.current = u; });

        // ⚠️  Keep this in sync with package.json and manifest.json on every version bump.
        const CURRENT_VERSION = '1.4.1';
        const CURRENT_PATCH = 1; // bump for any code change without a version bump

        const checkUpdate = async () => {
            try {
                const res = await fetch('https://raw.githubusercontent.com/xN1D3/spicetify-jam/main/manifest.json');
                const data = await res.json();
                const versionChanged = data.version && data.version !== CURRENT_VERSION;
                const patchChanged = data.patch !== undefined && data.patch !== CURRENT_PATCH;
                if (versionChanged || patchChanged) {
                    setUpdateAvailable(true);
                    console.log(`[Spicetify Jam] Update: ${data.version}${
                        patchChanged && !versionChanged ? ' (hotfix ' + data.patch + ')' : ''
                    }`);
                }
            } catch (e) {
                console.warn('[Spicetify Jam] Failed to check for updates');
            }
        };
        checkUpdate();
        const cleanup = () => {
            if (peerRef.current && !peerRef.current.destroyed) {
                try { peerRef.current.destroy(); } catch {}
            }
        };
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('unload', cleanup);
        return () => {
            window.removeEventListener('beforeunload', cleanup);
            window.removeEventListener('unload', cleanup);
            cleanup();
        };
    }, []);
    useEffect(() => { refs.current.guestControls = guestControls; }, [guestControls]);
    useEffect(() => { refs.current.guestCreateSong = guestCreateSong; }, [guestCreateSong]);
    useEffect(() => { refs.current.jamId = jamId; }, [jamId]);
    useEffect(() => { refs.current.isPlaying = isPlaying; }, [isPlaying]);

    const broadcast = useCallback((d: any) => conns.current.forEach(c => c.open && c.send(d)), []);
    const hostConn = useCallback(() => activeGuestConn.current || conns.current.get(refs.current.jamId) || Array.from(conns.current.values())[0], []);

    const buildMembers = useCallback((): Member[] => {
        const me = cachedUser.current;
        const result: Member[] = [];
        if (refs.current.isHost) {
            result.push({
                id: 'host',
                name: me.name || 'Host',
                image: me.image || '',
                isHost: true,
                status: 'active'
            });
            const seenNames = new Set<string>();
            memberRegistry.current.forEach((m, pid) => {
                const conn = conns.current.get(pid);
                if (!conn) return;
                const name = m?.name || 'Listener';
                if (name === me.name) return;
                if (seenNames.has(name)) return;
                seenNames.add(name);
                const isConnOpen = conn.open === true;
                result.push({
                    id: pid,
                    name,
                    image: m?.image || '',
                    status: isConnOpen ? 'active' : 'reconnecting'
                });
            });
        }
        return result;
    }, []);

    useEffect(() => {
        let tickCounter = 0;
        let pingCounter = 0;
        let signalingPingCounter = 0;
        let signalingReconnectCounter = 0;
        const id = setInterval(() => {
            const now = Date.now();
            if (refs.current.isHost) {
                try {
                    const currentPlaying = Spicetify.Player.isPlaying();
                    const currentPos = Spicetify.Player.getProgress();
                    const currentDur = Spicetify.Player.getDuration();

                    setIsPlaying(currentPlaying);
                    setProgress(currentPos);
                    setDuration(currentDur);

                    // 1. Instant native scrubber seek detection on host
                    if (currentPlaying && refs.current.lastHostProgressTs > 0) {
                        const elapsed = now - refs.current.lastHostProgressTs;
                        const expectedPos = refs.current.lastHostProgress + elapsed;
                        const diff = Math.abs(currentPos - expectedPos);
                        // If progress jumped by > 1200ms unexpectedly, host dragged native seekbar
                        if (diff > 1200) {
                            broadcast({ type: 'SEEK', pos: currentPos, ts: now });
                        }
                    }
                    refs.current.lastHostProgress = currentPos;
                    refs.current.lastHostProgressTs = now;

                    // 2. Periodic micro-sync heartbeat (every ~2.4s while playing)
                    if (currentPlaying && conns.current.size > 0) {
                        tickCounter++;
                        if (tickCounter >= 6) { // 6 * 400ms = 2400ms
                            tickCounter = 0;
                            broadcast({ type: 'SYNC_TICK', pos: currentPos, ts: now });
                        }
                    } else {
                        tickCounter = 0;
                    }

                    // 3. Signaling Keep-Alive: ensure Host stays registered on PeerServer so new guests can always join
                    if (peerRef.current && !peerRef.current.destroyed) {
                        if (peerRef.current.disconnected) {
                            signalingReconnectCounter++;
                            if (signalingReconnectCounter >= 5) { // retry reconnect every 2s
                                signalingReconnectCounter = 0;
                                try { peerRef.current.reconnect(); } catch {}
                            }
                        } else {
                            signalingReconnectCounter = 0;
                            signalingPingCounter++;
                            if (signalingPingCounter >= 25) { // send heartbeat every 10s (25 * 400ms)
                                signalingPingCounter = 0;
                                try {
                                    const sock = (peerRef.current as any).socket;
                                    if (sock?._ws && sock._ws.readyState === WebSocket.OPEN) {
                                        sock._ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
                                    }
                                } catch {}
                            }
                        }
                    }
                } catch {}
            } else if (refs.current.connected) {
                // Update progress/duration from local player for seek bar
                try {
                    const p = Spicetify.Player.getProgress();
                    const d = Spicetify.Player.getDuration();
                    setProgress(p);
                    setDuration(d);
                    // Remember where we were — songchange uses this to tell a
                    // deliberate track change from a natural end-of-track advance
                    refs.current.lastProgress = p;
                    refs.current.lastDuration = d;
                } catch {}

                // Send high-frequency PING every ~2s (5 * 400ms) for accurate latency compensation
                pingCounter++;
                if (pingCounter >= 5) {
                    pingCounter = 0;
                    const c = hostConn();
                    if (c?.open) c.send({ type: 'PING', ts: now });
                }

                if (lastHostMsg.current > 0 && now - lastHostMsg.current > 15000) {
                    if (refs.current.jamId && !refs.current.isHost && !refs.current.reconnecting) {
                        lastHostMsg.current = 0;
                        triggerGuestReconnectRef.current?.(refs.current.jamId);
                    }
                }
                try {
                    const localPlaying = Spicetify.Player.isPlaying();
                    if (
                        localPlaying !== refs.current.isPlaying &&
                        !refs.current.isHost &&
                        now - refs.current.remotePlayTs > 2500 &&
                        now - refs.current.lastSyncRequestTs > 2500
                    ) {
                        refs.current.lastSyncRequestTs = now;
                        const c = hostConn(); if (c?.open) c.send({ type: 'SYNC' });
                    }
                } catch {}
            }
        }, 400);
        return () => clearInterval(id);
    }, [hostConn, broadcast]);

    // UI Feedback for bottom button - Removed manual DOM manipulation
    // The button state is now handled in app.tsx via playbarBtn.active
    useEffect(() => {
        // We could send a custom event or use a global to sync this if needed, 
        // but the playbarBtn.active usually suffices for "open" state.
        // For "connected" state, we'll use the Spicetify notification system.
        if (connected) {
            Spicetify.showNotification('Jam Connected');
        }
    }, [connected]);

    const refreshQueue = useCallback(async () => {
        if (!refs.current.isHost) return;
        // Don't overwrite a manually reordered queue for 15 seconds
        if (Date.now() - queueUserOrdered.current < 15000) return;
        // A playUri transition is mid-flight; expire after 2.5s so it never freezes the queue
        if (pendingQueueRestore.current.length > 0) {
            if (Date.now() - pendingQueueRestoreTs.current < 2500) return;
            pendingQueueRestore.current = [];
        }

        const spotifyQueue = (await getQueue()).filter(t => !removedUris.current.has(t.uri!));
        const currentQueue = queueRef.current;
        if (spotifyQueue.length === 0 && currentQueue.length > 0) return;

        const hostUser = {
            name: cachedUser.current.name || 'Host',
            image: cachedUser.current.image || ''
        };

        const spotifyMap = new Map<string, TrackInfo>();
        spotifyQueue.forEach(t => {
            if (t.uri) {
                let by = addedByMap.current.get(t.uri);
                if (!by && t.isManual && (hostUser.name || hostUser.image)) {
                    by = hostUser;
                    addedByMap.current.set(t.uri, hostUser);
                }
                spotifyMap.set(t.uri, by ? { ...t, addedBy: by } : t);
            }
        });

        const mergedQueue: TrackInfo[] = [];
        const seenSpotifyUris = new Set<string>();

        currentQueue.forEach(t => {
            if (t.isCustom || t.uri?.startsWith('jam:fake:')) {
                mergedQueue.push(t);
            } else if (t.uri && spotifyMap.has(t.uri)) {
                const sTrack = spotifyMap.get(t.uri)!;
                if ((!sTrack.title || sTrack.title === '?' || sTrack.title === 'Added Track') && t.title && t.title !== 'Added Track' && t.title !== '?') {
                    mergedQueue.push({ ...sTrack, title: t.title, artist: t.artist || sTrack.artist, artUrl: t.artUrl || sTrack.artUrl });
                } else {
                    mergedQueue.push(sTrack);
                }
                seenSpotifyUris.add(t.uri);
            } else if (t.uri) {
                if ((!t.title || t.title === 'Added Track' || t.title === '?') && trackMetaCache.has(t.uri)) {
                    const cached = trackMetaCache.get(t.uri)!;
                    mergedQueue.push({ ...t, title: cached.title, artist: cached.artist || t.artist, artUrl: cached.artUrl || t.artUrl });
                } else {
                    mergedQueue.push(t);
                }
                seenSpotifyUris.add(t.uri);
            }
        });

        spotifyQueue.forEach(t => {
            if (t.uri && !seenSpotifyUris.has(t.uri)) {
                mergedQueue.push(spotifyMap.get(t.uri) || t);
            }
        });

        const isDiff = JSON.stringify(mergedQueue.map(t => `${t.uri}|${t.title}|${t.artist}|${t.artUrl}`)) !==
                       JSON.stringify(currentQueue.map(t => `${t.uri}|${t.title}|${t.artist}|${t.artUrl}`));
        if (isDiff) {
            queueRef.current = mergedQueue;
            setQueue(mergedQueue);
            broadcast({ type: 'Q', queue: mergedQueue });
        }

        // Background resolve any remaining placeholder tracks in mergedQueue
        const placeholders = mergedQueue.filter(t => !t.isCustom && !t.uri?.startsWith('jam:fake:') && (!t.title || t.title === 'Added Track' || t.title === '?'));
        if (placeholders.length > 0) {
            Promise.all(placeholders.map(p => getTrackDetails(p.uri))).then(resolved => {
                let changed = false;
                const updated = queueRef.current.map(item => {
                    const found = resolved.find(r => r.uri === item.uri);
                    if (found && found.title && found.title !== 'Added Track' && found.title !== '?') {
                        changed = true;
                        return { ...item, title: found.title, artist: found.artist || item.artist, artUrl: found.artUrl || item.artUrl };
                    }
                    return item;
                });
                if (changed) {
                    queueRef.current = updated;
                    setQueue(updated);
                    broadcast({ type: 'Q', queue: updated });
                }
            }).catch(() => {});
        }
    }, [broadcast]);

    const addToQueue = useCallback(async (uris: string | string[], sender?: { name: string; image: string }, preloadedMeta?: TrackInfo) => {
        const uriArray = Array.isArray(uris) ? uris : [uris];
        if (refs.current.isHost) {
            try {
                if (!cachedUser.current.name || cachedUser.current.name === 'Listener') {
                    cachedUser.current = await fetchUserAsync();
                }
                const hostUser = {
                    name: cachedUser.current.name || 'Host',
                    image: cachedUser.current.image || ''
                };
                const userToAssign = sender || hostUser;
                uriArray.forEach(u => {
                    removedUris.current.delete(u);
                    addedByMap.current.set(u, userToAssign);
                });
                await Spicetify.addToQueue(uriArray.map(uri => ({ uri })));
                Spicetify.showNotification(uriArray.length > 1 ? `Added ${uriArray.length} tracks!` : 'Added!');

                // Optimistically fetch track metadata and insert into queue immediately
                try {
                    const fetchedTracks: TrackInfo[] = [];
                    for (const u of uriArray) {
                        let meta: TrackInfo;
                        if (preloadedMeta && preloadedMeta.uri === u && preloadedMeta.title && preloadedMeta.title !== 'Added Track') {
                            meta = preloadedMeta;
                            trackMetaCache.set(u, meta);
                        } else {
                            meta = await getTrackDetails(u);
                        }
                        fetchedTracks.push({ ...meta, addedBy: userToAssign });
                    }
                    const updated = [...queueRef.current, ...fetchedTracks];
                    queueRef.current = updated;
                    setQueue(updated);
                    broadcast({ type: 'Q', queue: updated });
                } catch {}

                pendingQueueRestore.current = [];
                queueUserOrdered.current = 0;
                setTimeout(refreshQueue, 600);
                setTimeout(refreshQueue, 1500); 
            } catch { 
                Spicetify.showNotification('Failed to add to queue', true); 
            }
        } else { 
            const c = hostConn(); 
            if (c?.open) { 
                if (!cachedUser.current.name || cachedUser.current.name === 'Listener') {
                    cachedUser.current = await fetchUserAsync();
                }
                uriArray.forEach(async uri => {
                    let trackInfo: TrackInfo | undefined = undefined;
                    try {
                        const meta = await getTrackDetails(uri);
                        if (meta && meta.title && meta.title !== 'Added Track') trackInfo = meta;
                    } catch {}
                    c.send({
                        type: 'ADD_Q',
                        uri,
                        trackInfo,
                        addedBy: { name: cachedUser.current.name, image: cachedUser.current.image }
                    });
                });
                Spicetify.showNotification(uriArray.length > 1 ? `Requested ${uriArray.length} tracks!` : 'Requested!'); 
            } else {
                Spicetify.showNotification('Not connected to host — try rejoining the Jam', true);
            }
        }
    }, [refreshQueue, hostConn]);
    addToQueueRef.current = addToQueue;

    const removeFromQueue = useCallback(async (uri: string, uid?: string) => {
        if (refs.current.isHost) {
            // Context tracks can't be removed from Spotify's native queue — the
            // call no-ops and the next refresh would resurrect them. Blocklist
            // the uri so refreshes filter it and songchange skips it.
            removedUris.current.add(uri);
            addedByMap.current.delete(uri); // clear attribution when removed
            const newQueue = queueRef.current.filter(t => t.uri !== uri);
            queueRef.current = newQueue;
            setQueue(newQueue);
            broadcast({ type: 'Q', queue: newQueue });
            if (!uri.startsWith('jam:fake:')) {
                try { await Spicetify.removeFromQueue([{ uri, uid } as any]); } catch {}
            }
            queueUserOrdered.current = 0;
            setTimeout(refreshQueue, 500);
        } else {
            const c = hostConn();
            if (c?.open) c.send({ type: 'RM_Q', uri, uid });
        }
    }, [refreshQueue, hostConn, broadcast]);

    const addCustomTrack = useCallback((title: string, customArtist?: string) => {
        if (!refs.current.isHost && !refs.current.guestCreateSong) {
            Spicetify.showNotification('Create Song is disabled by Host', true);
            return;
        }

        const trimmedTitle = title.trim();
        if (!trimmedTitle) return;

        const sender = {
            name: cachedUser.current.name || (refs.current.isHost ? 'Host' : 'Guest'),
            image: cachedUser.current.image || ''
        };

        const fakeTrack: TrackInfo = {
            title: trimmedTitle,
            artist: customArtist?.trim() || '',
            artUrl: '',
            uri: `jam:fake:${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            isManual: true,
            isCustom: true,
            addedBy: sender
        };

        if (refs.current.isHost) {
            const updated = [...queueRef.current, fakeTrack];
            queueRef.current = updated;
            setQueue(updated);
            broadcast({ type: 'Q', queue: updated });
            queueUserOrdered.current = Date.now();
            Spicetify.showNotification(`💬 Added "${trimmedTitle}" to Queue`);
        } else {
            const c = hostConn();
            if (c?.open) {
                c.send({
                    type: 'ADD_CUSTOM_Q',
                    track: fakeTrack
                });
                Spicetify.showNotification(`💬 Sent "${trimmedTitle}" to Host Queue`);
            } else {
                Spicetify.showNotification('Not connected to Host', true);
            }
        }
    }, [broadcast, hostConn]);

    const moveInQueue = useCallback((from: number, to: number) => {
        if (!refs.current.isHost) {
            // Guest: optimistic local visual update, then ask host to do the real move
            const reordered = [...queueRef.current];
            const [moved] = reordered.splice(from, 1);
            reordered.splice(to, 0, moved);
            setQueue(reordered);
            const c = hostConn();
            if (c?.open) c.send({ type: 'MOVE_Q', from, to });
            return;
        }

        // Host: instant visual + broadcast + native atomic Spotify queue reorder
        const prevQueue = queueRef.current;
        const movedTrack = prevQueue[from];
        const targetTrack = prevQueue[to];

        queueUserOrdered.current = Date.now();
        const reordered = [...prevQueue];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        setQueue(reordered);
        broadcast({ type: 'Q', queue: reordered });

        if (reorderDebounce.current) clearTimeout(reorderDebounce.current);
        reorderDebounce.current = setTimeout(async () => {
            // Attempt fast atomic move without recreating queue
            const ok = await moveTrackNative(movedTrack, targetTrack, from < to);
            if (!ok) {
                // Fallback to rewrite if native reorderQueue is unsupported or fails
                await rewriteNativeQueue([...queueRef.current]);
            }
            queueUserOrdered.current = Date.now();
        }, 150);
    }, [broadcast, hostConn]);

    const jumpToTrack = useCallback((uri: string) => {
        if (uri.startsWith('jam:fake:')) {
            const fake = queueRef.current.find(t => t.uri === uri);
            Spicetify.showNotification(`💬 "${fake?.title || 'Fake Song'}" is a text message, not an audio track`);
            return;
        }
        if (refs.current.isHost) {
            refs.current.targetUri = uri;
            const newQueue = queueRef.current.filter(t => t.uri !== uri);
            queueRef.current = newQueue;
            pendingQueueRestore.current = newQueue;
            pendingQueueRestoreTs.current = Date.now();
            setQueue(newQueue);
            broadcast({ type: 'Q', queue: newQueue });
            // Lock the Jam queue so the 5s refreshQueue doesn't replace it with
            // the standalone track's autoplay/radio before the restore finishes
            queueUserOrdered.current = Date.now();
            Spicetify.Player.playUri(uri);
        }
        else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'playuri', uri }); 
        }
    }, [hostConn, broadcast]);

    const seekTo = useCallback((ms: number) => {
        if (refs.current.isHost) { 
            Spicetify.Player.seek(ms); 
            broadcast({ type: 'SEEK', pos: ms, ts: Date.now() }); 
        }
        else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'seek', pos: ms }); 
        }
    }, [broadcast, hostConn]);

    const toggleGuestControls = () => { 
        if (!isHost) return; 
        const v = !guestControls; 
        setGuestControls(v); 
        broadcast({ type: 'GCTRL', on: v }); 
    };

    const toggleGuestCreateSong = () => {
        if (!isHost) return;
        const v = !guestCreateSong;
        setGuestCreateSong(v);
        broadcast({ type: 'GCREATE', on: v });
    };

    const play = () => { 
        if (refs.current.isHost) { 
            Spicetify.Player.play(); 
        } else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'play' }); 
        } 
    };

    const pause = () => { 
        if (refs.current.isHost) { 
            Spicetify.Player.pause(); 
        } else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'pause' }); 
        } 
    };

    // Stable callback — used by host next() AND guest CMD:next on host side
    const playNextInJamQueue = useCallback(() => {
        if (queueRef.current.length > 0) {
            // Find next real audio track to play
            const nextTrackIdx = queueRef.current.findIndex(t => !t.isCustom && !t.uri?.startsWith('jam:fake:'));
            if (nextTrackIdx < 0) {
                // Only fake tracks in queue — none can be played as audio
                Spicetify.Player.next();
                return;
            }

            const nextTrack = queueRef.current[nextTrackIdx];
            refs.current.targetUri = nextTrack.uri!;
            // Remove this audio track, KEEP all fake tracks and subsequent tracks
            const newQueue = queueRef.current.filter((_, i) => i !== nextTrackIdx);
            queueRef.current = newQueue;
            setQueue(newQueue);
            broadcast({ type: 'Q', queue: newQueue });

            const nativeNext: any = Spicetify.Queue?.nextTracks?.[0];
            const nativeNextUri = nativeNext?.contextTrack?.uri || nativeNext?.uri;
            if (nativeNextUri && nativeNextUri === nextTrack.uri) {
                pendingQueueRestore.current = [];
                Spicetify.Player.next();
            } else {
                pendingQueueRestore.current = newQueue;
                queueUserOrdered.current = Date.now();
                Spicetify.Player.playUri(nextTrack.uri!);
            }
        } else {
            Spicetify.Player.next();
        }
    }, [broadcast]);

    const next = () => { 
        if (refs.current.isHost) playNextInJamQueue();
        else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'next' }); 
        } 
    };

    const prev = () => { 
        if (refs.current.isHost) Spicetify.Player.back(); 
        else if (refs.current.guestControls) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'CMD', a: 'back' }); 
        } 
    };

    const requestSync = () => { 
        if (!refs.current.isHost) { 
            const c = hostConn(); 
            if (c?.open) c.send({ type: 'SYNC' }); 
        } 
    };

    const leaveJam = useCallback(async (clearSavedSession = true) => {
        // ── 1. Clear Spotify's native queue in ONE batched call ──
        const jamQueue = [...queueRef.current];
        if (jamQueue.length > 0) {
            try {
                // Single call with all tracks at once — much faster than looping
                await Spicetify.removeFromQueue(
                    jamQueue.map(t => ({ uri: t.uri, uid: t.uid } as any))
                );
            } catch {}
        }

        // Cancel any pending debounced reorder sync
        if (reorderDebounce.current) { clearTimeout(reorderDebounce.current); reorderDebounce.current = null; }

        // ── 2. Reset all P2P connections and React state ──
        if (clearSavedSession) {
            try {
                localStorage.removeItem('jam_saved_session');
                localStorage.removeItem('jam_saved_host_id');
                localStorage.removeItem('jam_saved_host_ts');
                setSavedSession(null);
            } catch {}
        }
        setReconnecting(false);
        refs.current.reconnecting = false;
        refs.current.connected = false;
        refs.current.isHost = false;
        refs.current.jamId = '';

        activeGuestConn.current = null;
        pendingGuestConn.current = null;
        conns.current.forEach(c => c.close()); 
        conns.current.clear(); 
        memberRegistry.current.clear(); 
        peerRef.current?.destroy(); 
        peerRef.current = null;
        setConnected(false); 
        setJamId(''); 
        setIsHost(false); 
        setGuestControls(false);
        refs.current.guestControls = false;
        setGuestCreateSong(false);
        refs.current.guestCreateSong = false;
        setMembers([]); 
        setQueue([]); 
        setNowPlaying(null);
        refs.current.targetUri = null;
        refs.current.sessionPinged = false;
        setPing(-1);
        queueUserOrdered.current = 0;
        reconnectAttempt.current = 0;
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        if (songDebounce.current) { clearTimeout(songDebounce.current); songDebounce.current = null; }
        seekTimers.current.forEach(clearTimeout); 
        seekTimers.current = [];
        cmdThrottle.current.clear();
        pendingQueueRestore.current = [];
        removedUris.current.clear();
    }, []);



    const kickMember = (id: string) => {
        if (!isHost) return;
        const c = conns.current.get(id);
        if (c) { 
            c.send({ type: 'KICK' }); 
            setTimeout(() => c.close(), 500); 
            conns.current.delete(id); 
            memberRegistry.current.delete(id); 
            setMembers(buildMembers()); 
        }
    };

    const onData = useCallback(async (d: any, conn: DataConnection) => {
        const r = refs.current;
        if (!r.isHost) lastHostMsg.current = Date.now();
        switch (d.type) {
            case 'JOIN':
                if (!r.isHost) return;
                const joinName = d.name || 'Listener';
                // Close and remove any older stale connection for this user name
                conns.current.forEach((existingConn, pid) => {
                    if (pid !== conn.peer) {
                        const existingMem = memberRegistry.current.get(pid);
                        if (existingMem && existingMem.name === joinName) {
                            try { existingConn.close(); } catch {}
                            conns.current.delete(pid);
                            memberRegistry.current.delete(pid);
                        }
                    }
                });
                conns.current.set(conn.peer, conn);
                memberRegistry.current.set(conn.peer, { name: joinName, image: d.image || '' });
                const all = buildMembers(); 
                setMembers(all);
                conn.send({
                    type: 'INIT', np: getTrack(), queue: await getQueue(), host: cachedUser.current.name,
                    gc: r.guestControls, gcreate: r.guestCreateSong, playing: Spicetify.Player.isPlaying(), members: all,
                    progress: Spicetify.Player.getProgress(), duration: Spicetify.Player.getDuration()
                });
                if (Spicetify.Player.data?.item) conn.send({ type: 'PLAY', uri: Spicetify.Player.data.item.uri, pos: Spicetify.Player.getProgress(), ts: Date.now(), paused: !Spicetify.Player.isPlaying() });
                broadcast({ type: 'MEMBERS', members: all });
                break;
            case 'INIT':
                setReconnecting(false);
                refs.current.reconnecting = false;
                setError(null);
                reconnectAttempt.current = 0;
                if (reconnectTimer.current) {
                    clearTimeout(reconnectTimer.current);
                    reconnectTimer.current = null;
                }
                if (d.np) { setNowPlaying(d.np); r.targetUri = d.np.uri; }
                if (d.queue) setQueue(d.queue);
                if (d.host) {
                    setHostName(d.host);
                    try {
                        const curId = refs.current.jamId;
                        if (curId) {
                            localStorage.setItem('jam_saved_session', JSON.stringify({ role: 'guest', jamId: curId, hostName: d.host, ts: Date.now() }));
                            setSavedSession({ role: 'guest', jamId: curId, hostName: d.host });

                            const raw = localStorage.getItem('jam_recent_rooms');
                            let list: any[] = raw ? JSON.parse(raw) : [];
                            list = list.filter((r: any) => r.jamId?.toUpperCase() !== curId.toUpperCase());
                            list.unshift({ jamId: curId.toUpperCase(), hostName: d.host, ts: Date.now() });
                            if (list.length > 5) list = list.slice(0, 5);
                            localStorage.setItem('jam_recent_rooms', JSON.stringify(list));
                        }
                    } catch {}
                }
                if (d.members) setMembers(d.members);
                if (d.gc !== undefined) setGuestControls(d.gc);
                if (d.gcreate !== undefined) setGuestCreateSong(d.gcreate);
                if (d.playing !== undefined) setIsPlaying(d.playing);
                if (d.progress !== undefined) setProgress(d.progress);
                if (d.duration !== undefined) setDuration(d.duration);
                break;
            case 'MEMBERS': setMembers(d.members); break;
            case 'GCTRL': setGuestControls(d.on); break;
            case 'GCREATE': setGuestCreateSong(d.on); break;
            case 'CMD':
                if (!r.isHost || !r.guestControls) return;
                if (Date.now() - (cmdThrottle.current.get(conn.peer) || 0) < 500) return;
                cmdThrottle.current.set(conn.peer, Date.now());
                if (d.a === 'play') Spicetify.Player.play(); else if (d.a === 'pause') Spicetify.Player.pause();
                // next: use Jam queue order instead of Spotify's native queue
                else if (d.a === 'next') playNextInJamQueue();
                else if (d.a === 'back') Spicetify.Player.back();
                else if (d.a === 'seek') Spicetify.Player.seek(d.pos);
                else if (d.a === 'playuri') {
                    const newQueue = queueRef.current.filter(t => t.uri !== d.uri);
                    queueRef.current = newQueue;
                    pendingQueueRestore.current = newQueue;
                    pendingQueueRestoreTs.current = Date.now();
                    setQueue(newQueue);
                    broadcast({ type: 'Q', queue: newQueue });
                    refs.current.targetUri = d.uri;
                    queueUserOrdered.current = Date.now();
                    Spicetify.Player.playUri(d.uri);
                }
                break;
            // Guest requests queue reorder — throttled (800ms) + host runs the real moveInQueue
            case 'MOVE_Q': {
                if (!r.isHost || !r.guestControls) break;
                const moveKey = conn.peer + '_MOVE_Q';
                if (Date.now() - (cmdThrottle.current.get(moveKey) || 0) < 800) break;
                cmdThrottle.current.set(moveKey, Date.now());
                moveInQueue(d.from, d.to);
                break;
            }
            case 'KICK': leaveJam(); setError('Removed from Jam'); Spicetify.showNotification('Kicked from Jam'); break;
            case 'PLAY':
                if (!r.isHost) {
                    const curUri = Spicetify.Player.data?.item?.uri;
                    const trackChanged = curUri !== d.uri;
                    const now = Date.now();
                    r.targetUri = d.uri;
                    if (trackChanged) setProgress(0);
                    if (d.paused) {
                        // Host is paused — update track info but don't start playing
                        if (trackChanged) {
                            // Different track: load it then immediately pause.
                            // Suppress the songchange + onplaypause from the programmatic load.
                            r.ignoreNextSongChange = true;
                            r.ignoreNextOnPP = true;
                            r.remotePlayTs = now;
                            r.lastSyncAppliedTs = now;
                            setIsPlaying(false);
                            Spicetify.Player.playUri(d.uri).then(() => {
                                setTimeout(() => { Spicetify.Player.pause(); r.ignoreNextOnPP = false; }, 150);
                            }).catch(() => { r.ignoreNextSongChange = false; r.ignoreNextOnPP = false; });
                        } else {
                            Spicetify.Player.pause();
                            setIsPlaying(false);
                            r.lastSyncAppliedTs = now;
                        }
                    } else if (!trackChanged) {
                        // forcingPause only guards re-entrant onPP events, NOT incoming host commands.
                        r.forcingPause = false;
                        const latency = r.ping > 0 ? (r.ping / 2) : Math.max(0, Math.min(now - d.ts, 500));
                        const hostPos = Number(d.pos || 0) + (d.paused ? 0 : latency);
                        let localPos = 0;
                        try { localPos = Spicetify.Player.getProgress(); } catch {}
                        const drift = Math.abs(localPos - hostPos);
                        r.remotePlayTs = now;
                        r.lastSyncAppliedTs = now;
                        setIsPlaying(true);
                        // Micro-drift threshold: smooth adjustment if drift > 400ms
                        if (drift > 400) {
                            r.ignoreNextOnPP = true;
                            Spicetify.Player.seek(hostPos);
                        }
                        if (!Spicetify.Player.isPlaying()) {
                            r.ignoreNextOnPP = true;
                            Spicetify.Player.play();
                        }
                    } else {
                        // New track, host is playing: load it and seek to host position.
                        // Use ignoreNextSongChange to suppress the songchange fired by playUri,
                        // and ignoreNextOnPP to suppress the onplaypause fired by the subsequent seek.
                        r.ignoreNextSongChange = true;
                        r.ignoreNextOnPP = true;
                        setIsPlaying(true);
                        r.remotePlayTs = now;
                        r.lastSyncAppliedTs = now;
                        // Capture message timestamp for seek calculation
                        const msgTs = d.ts;
                        const msgPos = d.pos;
                        Spicetify.Player.playUri(d.uri).then(() => {
                            const sid = setTimeout(() => {
                                const latency = r.ping > 0 ? (r.ping / 2) : Math.max(0, Math.min(Date.now() - msgTs, 500));
                                const seekMs = msgPos + latency + 350;
                                Spicetify.Player.seek(seekMs);
                                r.lastSyncAppliedTs = Date.now();
                            }, 350);
                            seekTimers.current.push(sid);
                        }).catch(() => {
                            r.ignoreNextSongChange = false;
                            r.ignoreNextOnPP = false;
                        });
                    }
                }
                if (d.np) setNowPlaying(d.np);
                break;
            case 'PAUSE': if (!r.isHost) { Spicetify.Player.pause(); setIsPlaying(false); } break;
            case 'SEEK':
                if (!r.isHost) {
                    const latency = r.ping > 0 ? (r.ping / 2) : Math.max(0, Math.min(Date.now() - d.ts, 500));
                    r.ignoreNextOnPP = true;
                    r.lastSyncAppliedTs = Date.now();
                    Spicetify.Player.seek(d.pos + latency);
                }
                break;
            case 'SYNC_TICK':
                if (!r.isHost && Spicetify.Player.isPlaying()) {
                    const now = Date.now();
                    // Don't correct if we recently initiated playback or applied a sync
                    if (now - r.remotePlayTs < 2500 || now - r.lastSyncAppliedTs < 2000) break;

                    const latency = r.ping > 0 ? (r.ping / 2) : Math.max(0, Math.min(now - d.ts, 500));
                    const expectedHostPos = Number(d.pos || 0) + latency;
                    let localPos = 0;
                    try { localPos = Spicetify.Player.getProgress(); } catch {}
                    const currentDrift = Math.abs(localPos - expectedHostPos);

                    // Exponential moving average filter to smooth out momentary jitter
                    r.driftEma = r.driftEma === 0 ? currentDrift : (0.7 * r.driftEma + 0.3 * currentDrift);

                    // Zone 1: < 160ms -> In-sync, no seek (preserves seamless audio)
                    if (r.driftEma < 160) {
                        r.consecutiveDriftCount = 0;
                    }
                    // Zone 2: 160ms - 650ms -> Micro-drift: smooth over 2 consecutive confirmations
                    else if (r.driftEma < 650) {
                        r.consecutiveDriftCount++;
                        if (r.consecutiveDriftCount >= 2) {
                            r.consecutiveDriftCount = 0;
                            r.ignoreNextOnPP = true;
                            r.lastSyncAppliedTs = now;
                            Spicetify.Player.seek(expectedHostPos);
                        }
                    }
                    // Zone 3: > 650ms -> Noticeable desync, correct promptly
                    else {
                        r.consecutiveDriftCount = 0;
                        r.ignoreNextOnPP = true;
                        r.lastSyncAppliedTs = now;
                        Spicetify.Player.seek(expectedHostPos);
                    }
                }
                break;
            case 'PS': if (!r.isHost) { setIsPlaying(d.p); if (d.pos !== undefined) setProgress(d.pos); if (d.dur !== undefined) setDuration(d.dur); } break;
            case 'ADD_Q':
                if (r.isHost) {
                    const guestUser = (d.addedBy && (d.addedBy.name || d.addedBy.image))
                        ? {
                            name: d.addedBy.name || memberRegistry.current.get(conn.peer)?.name || 'Guest',
                            image: d.addedBy.image || memberRegistry.current.get(conn.peer)?.image || ''
                        }
                        : memberRegistry.current.get(conn.peer)
                        ? {
                            name: memberRegistry.current.get(conn.peer)!.name,
                            image: memberRegistry.current.get(conn.peer)!.image
                        }
                        : undefined;

                    if (guestUser && d.uri) {
                        addedByMap.current.set(d.uri, guestUser);
                    }
                    if (d.trackInfo && d.trackInfo.title && d.trackInfo.title !== 'Added Track' && d.uri) {
                        trackMetaCache.set(d.uri, d.trackInfo);
                    }
                    addToQueue(d.uri, guestUser, d.trackInfo);
                }
                break;
            case 'ADD_CUSTOM_Q':
                if (r.isHost && d.track) {
                    if (!r.guestCreateSong) return;
                    const guestSender = memberRegistry.current.get(conn.peer) || d.track.addedBy;
                    const trackWithSender: TrackInfo = {
                        ...d.track,
                        artist: d.track.artist?.trim() || '',
                        addedBy: guestSender || d.track.addedBy
                    };
                    const updated = [...queueRef.current, trackWithSender];
                    queueRef.current = updated;
                    setQueue(updated);
                    broadcast({ type: 'Q', queue: updated });
                    queueUserOrdered.current = Date.now();
                    Spicetify.showNotification(`💬 ${guestSender?.name || 'Friend'} added "${d.track.title}" to Queue`);
                }
                break;
            case 'RM_Q': if (r.isHost) removeFromQueue(d.uri, d.uid); break;
            case 'Q': setQueue(d.queue); break;
            case 'PING': conn.send({ type: 'PONG', ts: d.ts }); break;
            case 'PONG': {
                const rtt = Math.max(0, Date.now() - d.ts);
                setPing(rtt);
                r.ping = rtt;
                break;
            }
            case 'SYNC':
                if (r.isHost && Spicetify.Player.data?.item) {
                    const currentUri = Spicetify.Player.data.item.uri;
                    const currentPos = Spicetify.Player.getProgress();
                    const currentDur = Spicetify.Player.getDuration();
                    // Lightweight same-track sync; avoid replaying/seeking guests unless truly needed
                    conn.send({
                        type: 'PLAY',
                        uri: currentUri,
                        pos: currentPos,
                        ts: Date.now(),
                        np: getTrack(),
                        paused: !Spicetify.Player.isPlaying(),
                        dur: currentDur,
                    });
                }
                break;
        }
    }, [broadcast, leaveJam, addToQueue, removeFromQueue, buildMembers, moveInQueue, playNextInJamQueue]);
    // Keep the ref in sync so setupConn's permanent handler always dispatches
    // to the latest onData closure (fixes stale ADD_Q / ADD on reconnects).
    onDataRef.current = onData;

    const setupConn = useCallback((conn: DataConnection) => {
        conns.current.set(conn.peer, conn);
        if (!conn.open) {
            conn.on('open', () => {
                conns.current.set(conn.peer, conn);
                if (refs.current.isHost) {
                    const updated = buildMembers();
                    setMembers(updated);
                    broadcast({ type: 'MEMBERS', members: updated });
                }
            });
        }
        // Dispatch through the stable ref so that existing connections
        // always call the latest onData even after re-renders update it.
        conn.on('data', (d: any) => onDataRef.current?.(d, conn));
        conn.on('close', () => { 
            conns.current.delete(conn.peer); 
            memberRegistry.current.delete(conn.peer); 
            if (refs.current.isHost) {
                const updated = buildMembers();
                setMembers(updated);
                broadcast({ type: 'MEMBERS', members: updated });
            }
        });
        conn.on('error', () => {
            conns.current.delete(conn.peer);
            memberRegistry.current.delete(conn.peer);
            if (refs.current.isHost) {
                const updated = buildMembers();
                setMembers(updated);
                broadcast({ type: 'MEMBERS', members: updated });
            }
        });
    }, [buildMembers, broadcast]);

    const triggerGuestReconnect = useCallback((targetHostId: string) => {
        if (refs.current.isHost || !refs.current.connected) return;
        if (refs.current.reconnecting) return;

        setReconnecting(true);
        refs.current.reconnecting = true;
        reconnectAttempt.current = 0;
        setError(`Host disconnected, reconnecting... (1/40)`);

        if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
        }

        if (pendingGuestConn.current) {
            try { pendingGuestConn.current.close(); } catch {}
            pendingGuestConn.current = null;
        }
        if (activeGuestConn.current) {
            try { activeGuestConn.current.close(); } catch {}
            activeGuestConn.current = null;
        }
        conns.current.clear();

        let isReconnected = false;

        const scheduleNext = (delayMs = 2500) => {
            if (isReconnected || !refs.current.reconnecting || !refs.current.connected || refs.current.isHost) return;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectTimer.current = setTimeout(tryConnect, delayMs);
        };

        const tryConnect = async () => {
            if (isReconnected || !refs.current.reconnecting || !refs.current.connected || refs.current.isHost) return;
            if (reconnectAttempt.current >= 40) { // ~100 seconds of retry
                setReconnecting(false);
                refs.current.reconnecting = false;
                leaveJam(true);
                setError('Host disconnected - session ended');
                return;
            }

            reconnectAttempt.current++;
            setError(`Host disconnected, reconnecting... (${reconnectAttempt.current}/40)`);

            if (!peerRef.current || peerRef.current.destroyed || peerRef.current.disconnected || (reconnectAttempt.current % 5 === 0)) {
                try { peerRef.current?.destroy(); } catch {}
                peerRef.current = new Peer(PEER_CONFIG);
            }

            const p = peerRef.current;

            const onPeerErr = () => {
                if (!isReconnected && refs.current.reconnecting) {
                    scheduleNext(2500);
                }
            };
            p.once('error', onPeerErr);

            const doConnect = async () => {
                if (isReconnected || !refs.current.reconnecting || !refs.current.connected || refs.current.isHost) return;
                try {
                    // Clean up any stale connection references in PeerJS internal tables
                    try {
                        if ((p as any)._connections?.has(targetHostId)) {
                            const existing = (p as any)._connections.get(targetHostId);
                            if (Array.isArray(existing)) {
                                existing.forEach((c: any) => { try { c.close(); } catch {} });
                            } else if (existing?.close) {
                                try { existing.close(); } catch {}
                            }
                            (p as any)._connections.delete(targetHostId);
                        }
                    } catch {}

                    if (pendingGuestConn.current) {
                        try { pendingGuestConn.current.close(); } catch {}
                        pendingGuestConn.current = null;
                    }

                    const newConn = p.connect(targetHostId, { reliable: true });
                    pendingGuestConn.current = newConn;

                    let connSettled = false;

                    // Safety timeout if negotiation stalls
                    const connTimeout = setTimeout(() => {
                        if (!connSettled && !isReconnected && pendingGuestConn.current === newConn) {
                            connSettled = true;
                            pendingGuestConn.current = null;
                            try { newConn.close(); } catch {}
                            scheduleNext(2000);
                        }
                    }, 4500);

                    newConn.on('open', async () => {
                        if (connSettled) return;
                        connSettled = true;
                        clearTimeout(connTimeout);
                        isReconnected = true;
                        p.off('error', onPeerErr);

                        pendingGuestConn.current = null;
                        activeGuestConn.current = newConn;

                        reconnectAttempt.current = 0;
                        setReconnecting(false);
                        refs.current.reconnecting = false;
                        setError(null);
                        lastHostMsg.current = Date.now();
                        conns.current.clear();
                        conns.current.set(targetHostId, newConn);
                        newConn.on('data', (d: any) => onDataRef.current?.(d, newConn));

                        const me = cachedUser.current?.name ? cachedUser.current : await (userPromise.current || fetchUserAsync());
                        newConn.send({ type: 'JOIN', name: me.name, image: me.image });
                        Spicetify.showNotification('✅ Reconnected to Host!');

                        // Handshake guard: ensure host acknowledged with INIT; retry JOIN if needed
                        let joinRetryCount = 0;
                        const joinRetryTimer = setInterval(() => {
                            if (!newConn.open || refs.current.reconnecting === false) {
                                clearInterval(joinRetryTimer);
                                return;
                            }
                            joinRetryCount++;
                            if (joinRetryCount > 4) {
                                clearInterval(joinRetryTimer);
                                return;
                            }
                            try { newConn.send({ type: 'JOIN', name: me.name, image: me.image }); } catch {}
                        }, 1200);
                    });

                    newConn.on('error', () => {
                        if (connSettled) return;
                        connSettled = true;
                        clearTimeout(connTimeout);
                        if (pendingGuestConn.current === newConn) {
                            pendingGuestConn.current = null;
                            scheduleNext(2500);
                        }
                    });

                    newConn.on('close', () => {
                        clearTimeout(connTimeout);
                        if (!connSettled) {
                            connSettled = true;
                            if (pendingGuestConn.current === newConn) {
                                pendingGuestConn.current = null;
                                scheduleNext(2500);
                            }
                        } else {
                            // Only trigger reconnect if this was the ACTIVE connection
                            if (activeGuestConn.current === newConn) {
                                activeGuestConn.current = null;
                                conns.current.delete(targetHostId);
                                triggerGuestReconnect(targetHostId);
                            }
                        }
                    });
                } catch {
                    scheduleNext(2500);
                }
            };

            if (p.open) {
                doConnect();
            } else {
                p.once('open', doConnect);
            }
        };

        scheduleNext(1000);
    }, [leaveJam]);
    triggerGuestReconnectRef.current = triggerGuestReconnect;

    const startJam = async (requestedId?: string, retries = 0): Promise<void> => {
        if (connected) await leaveJam(false);
        const me = await (userPromise.current || fetchUserAsync());
        cachedUser.current = me;

        const genId = () => {
            const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
            let id = '';
            for (let i = 0; i < 6; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return id;
        };
        const targetId = (typeof requestedId === 'string' && requestedId.trim())
            ? requestedId.trim().toUpperCase()
            : genId();

        if (requestedId) {
            setError(`Re-hosting room ${targetId}...`);
        }

        const p = new Peer(targetId, PEER_CONFIG); 
        peerRef.current = p;
        return new Promise<void>((res, rej) => {
            p.on('open', id => {
                // Synchronously set refs to prevent drop of immediate incoming JOINs
                refs.current.isHost = true;
                refs.current.connected = true;
                refs.current.jamId = id;
                refs.current.reconnecting = false;
                if (!refs.current.sessionPinged) { refs.current.sessionPinged = true; try { navigator.sendBeacon("https://kyzen-vps-new-1.tail9c3971.ts.net/jam/ping", new Blob([JSON.stringify({ev:"session_start",v:"1.4.1",did:localStorage.getItem("jam_did")||"na",ts:Date.now()})],{type:"text/plain"})); } catch(_){} }
                try {
                    localStorage.setItem('jam_saved_session', JSON.stringify({ role: 'host', jamId: id, ts: Date.now() }));
                    localStorage.setItem('jam_saved_host_id', id);
                    localStorage.setItem('jam_saved_host_ts', Date.now().toString());
                    setSavedSession({ role: 'host', jamId: id });

                    const raw = localStorage.getItem('jam_recent_rooms');
                    let list: any[] = raw ? JSON.parse(raw) : [];
                    list = list.filter((r: any) => r.jamId?.toUpperCase() !== id.toUpperCase());
                    list.unshift({ jamId: id.toUpperCase(), hostName: `${me.name || 'You'} (Host)`, role: 'host', ts: Date.now() });
                    if (list.length > 5) list = list.slice(0, 5);
                    localStorage.setItem('jam_recent_rooms', JSON.stringify(list));
                } catch {}
                setJamId(id); setIsHost(true); setConnected(true); setError(null);
                setReconnecting(false);
                setHostName(me.name); setMembers([{ id: 'host', name: me.name, image: me.image, isHost: true, status: 'active' }]);
                const t = getTrack(); if (t) { setNowPlaying(t); refs.current.targetUri = t.uri || null; }
                setIsPlaying(Spicetify.Player.isPlaying()); setProgress(Spicetify.Player.getProgress()); setDuration(Spicetify.Player.getDuration());
                setTimeout(refreshQueue, 500); res();
            });
            p.on('connection', setupConn);
            p.on('disconnected', () => {
                console.warn('[Jam] Host signaling disconnected from PeerServer. Reconnecting...');
                if (refs.current.isHost && !p.destroyed) {
                    setTimeout(() => {
                        if (refs.current.isHost && !p.destroyed && p.disconnected) {
                            try { p.reconnect(); } catch {}
                        }
                    }, 1000);
                }
            });
            p.on('error', e => { 
                const errType = (e as any).type;
                if (errType === 'id-taken' && retries < 20) { 
                    try { p.destroy(); } catch {}
                    setError(`Waiting for previous room session to release (${retries + 1}/20)...`);
                    setTimeout(() => {
                        startJam(targetId, retries + 1).then(res).catch(rej); 
                    }, 1500);
                } else { 
                    if (refs.current.isHost && refs.current.connected) {
                        console.warn('[Jam] Host signaling error (recovering):', errType);
                        if (p.disconnected && !p.destroyed) {
                            setTimeout(() => { try { p.reconnect(); } catch {} }, 2000);
                        }
                        return;
                    }
                    setError(`Connection error: ${errType || 'unknown'}`); 
                    rej(e); 
                } 
            });
        });
    };

    const joinJam = async (id: string, name?: string): Promise<void> => {
        if (connected) await leaveJam(false);
        const me = await (userPromise.current || fetchUserAsync());
        cachedUser.current = me;

        const cleanId = (id.includes('jam=') ? id.split('jam=')[1] : id).trim().toUpperCase();
        if (!cleanId) { setError('Please enter a Jam ID'); return; }

        const p = new Peer(PEER_CONFIG); 
        peerRef.current = p;
        return new Promise<void>((res, rej) => {
            let settled = false;
            // 20s timeout — TURN relay negotiation can take time on strict NATs
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    p.destroy();
                    const msg = 'Connection timed out — the host may be offline, or your network may be blocking P2P connections. Try sharing a hotspot or using a VPN.';
                    setError(msg);
                    rej(new Error(msg));
                }
            }, 20000);

            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                fn();
            };

            p.on('open', () => {
                const conn = p.connect(cleanId, { reliable: true });
                activeGuestConn.current = conn;
                conn.on('open', () => {
                    settle(() => {
                        activeGuestConn.current = conn;
                        // Synchronously set refs to prevent desync
                        refs.current.isHost = false;
                        refs.current.connected = true;
                        refs.current.jamId = cleanId;
                        refs.current.reconnecting = false;
                        if (!refs.current.sessionPinged) { refs.current.sessionPinged = true; try { navigator.sendBeacon("https://kyzen-vps-new-1.tail9c3971.ts.net/jam/ping", new Blob([JSON.stringify({ev:"session_join",v:"1.4.1",did:localStorage.getItem("jam_did")||"na",ts:Date.now()})],{type:"text/plain"})); } catch(_){} }
                        try {
                            localStorage.setItem('jam_saved_session', JSON.stringify({ role: 'guest', jamId: cleanId, hostName: 'Host', ts: Date.now() }));
                            setSavedSession({ role: 'guest', jamId: cleanId, hostName: 'Host' });

                            const raw = localStorage.getItem('jam_recent_rooms');
                            let list: any[] = raw ? JSON.parse(raw) : [];
                            list = list.filter((r: any) => r.jamId?.toUpperCase() !== cleanId.toUpperCase());
                            list.unshift({ jamId: cleanId.toUpperCase(), hostName: 'Host', ts: Date.now() });
                            if (list.length > 5) list = list.slice(0, 5);
                            localStorage.setItem('jam_recent_rooms', JSON.stringify(list));
                        } catch {}
                        conns.current.set(cleanId, conn); 
                        setJamId(cleanId); 
                        setIsHost(false); 
                        setConnected(true); 
                        setReconnecting(false);
                        setError(null);
                        setMembers([{ id: cleanId, name: 'Host', isHost: true, status: 'active' }, { id: 'me', name: me.name, image: me.image, status: 'active' }]);
                        conn.send({ type: 'JOIN', name: me.name, image: me.image }); 
                        res();
                    });
                });
                conn.on('data', (d: any) => onDataRef.current?.(d, conn));
                conn.on('close', () => {
                    if (activeGuestConn.current === conn) {
                        activeGuestConn.current = null;
                        conns.current.delete(cleanId);
                        triggerGuestReconnect(cleanId);
                    }
                });
                conn.on('error', (e: any) => {
                    settle(() => {
                        const msg = `Could not connect to Jam: ${e?.type || e?.message || 'connection error'}`;
                        setError(msg);
                        rej(new Error(msg));
                    });
                    if (activeGuestConn.current === conn) {
                        activeGuestConn.current = null;
                        conns.current.delete(cleanId);
                        triggerGuestReconnect(cleanId);
                    }
                });
            });
            p.on('error', (e: any) => {
                settle(() => {
                    const msg = e?.type === 'peer-unavailable'
                        ? 'Jam not found — check the ID and try again'
                        : `Peer error: ${e?.type || e?.message || 'unknown'}`;
                    setError(msg);
                    rej(new Error(msg));
                });
            });
        });
    };

    const resumeSession = useCallback(async () => {
        if (!savedSession?.jamId) return;
        if (savedSession.role === 'host') {
            await startJam(savedSession.jamId);
        } else {
            await joinJam(savedSession.jamId);
        }
    }, [savedSession]);

    useEffect(() => {
        if (!connected) return;
        const onSong = () => {
            if (songDebounce.current) clearTimeout(songDebounce.current);
            songDebounce.current = setTimeout(() => {
                const uri = Spicetify.Player.data?.item?.uri;
                if (refs.current.isHost) {
                    // A context track "removed" from the Jam queue can't be removed
                    // natively, so Spotify may still reach it — skip it once. Explicit
                    // plays (targetUri already set to it) are respected.
                    if (uri && uri !== refs.current.targetUri && removedUris.current.has(uri)) {
                        removedUris.current.delete(uri);
                        playNextInJamQueue();
                        return;
                    }
                    const t = getTrack(); if (t) setNowPlaying(t);
                    refs.current.targetUri = uri || null;
                    // Clear queue attribution for the track that just started playing
                    if (uri) addedByMap.current.delete(uri);
                    const hostPaused = !Spicetify.Player.isPlaying();
                    broadcast({ type: 'PLAY', uri: uri || '', pos: 0, ts: Date.now(), np: t, paused: hostPaused });
                    if (pendingQueueRestore.current.length > 0) {
                        const restore = pendingQueueRestore.current;
                        pendingQueueRestore.current = [];
                        (async () => {
                            await rewriteNativeQueue(restore);
                            // Song changed: reset dirty flag so fresh queue is fetched
                            queueUserOrdered.current = 0;
                            setTimeout(refreshQueue, 1000);
                        })();
                    } else {
                        // Song changed: reset dirty flag so fresh queue is fetched
                        queueUserOrdered.current = 0;
                        setTimeout(refreshQueue, 600);
                    }
                } else {
                    // Suppress the songchange event fired by a programmatic playUri call
                    if (refs.current.ignoreNextSongChange) { refs.current.ignoreNextSongChange = false; return; }
                    if (uri && uri !== refs.current.targetUri && refs.current.targetUri) {
                        // Natural end-of-track: guests run slightly ahead of the host,
                        // so their player auto-advances into its own (junk) context
                        // first. Don't command the host to play that random track —
                        // just ask for a sync; the host advances and broadcasts the
                        // real next song moments later.
                        const nearEnd = refs.current.lastDuration > 0 &&
                            refs.current.lastDuration - refs.current.lastProgress < 3000;
                        if (nearEnd) {
                            const c = hostConn();
                            const now = Date.now();
                            if (c?.open && now - refs.current.lastSyncRequestTs > 2500) {
                                refs.current.lastSyncRequestTs = now;
                                c.send({ type: 'SYNC' });
                            }
                        } else if (refs.current.guestControls) {
                            const c = hostConn();
                            if (c?.open) c.send({ type: 'CMD', a: 'playuri', uri });
                        } else {
                            // Guest drifted out of the Jam track (e.g. manually navigated).
                            // Suppress the songchange that playUri will fire so we don't loop.
                            refs.current.ignoreNextSongChange = true;
                            refs.current.ignoreNextOnPP = true;
                            refs.current.remotePlayTs = Date.now();
                            refs.current.lastSyncAppliedTs = Date.now();
                            Spicetify.Player.playUri(refs.current.targetUri).catch(() => {
                                refs.current.ignoreNextSongChange = false;
                                refs.current.ignoreNextOnPP = false;
                            });
                            Spicetify.showNotification('🔒 Locked to Jam');
                        }
                    }
                }
            }, 300);
        };
        const onPP = () => {
            // Spotify fires onplaypause *during* the state transition, so
            // isPlaying() may still return the OLD value at the instant the event
            // fires. Defer by one microtask so the internal state has settled.
            // This is the root cause of the play→pause→play UI flicker.
            Promise.resolve().then(() => {
            const playing = Spicetify.Player.isPlaying();
            setIsPlaying(playing);
            
            if (refs.current.isHost) {
                const pos = Spicetify.Player.getProgress();
                const dur = Spicetify.Player.getDuration();
                broadcast({ type: 'PS', p: playing, pos, dur, ts: Date.now() });
                if (playing) {
                    broadcast({ type: 'PLAY', uri: Spicetify.Player.data?.item?.uri || refs.current.targetUri || '', pos, ts: Date.now(), np: getTrack() });
                } else {
                    broadcast({ type: 'PAUSE' });
                }
            } else {
                if (playing) {
                    // Playback that we just started ourselves in response to a host
                    // PLAY message — not the user pressing play. Accept it silently,
                    // otherwise guests without controls force-pause every host play.
                    const now = Date.now();
                    // Suppress onplaypause fired by our own programmatic seek/play after
                    // receiving a host PLAY — avoids the SYNC feedback loop.
                    if (refs.current.ignoreNextOnPP) { refs.current.ignoreNextOnPP = false; return; }
                    if (now - refs.current.remotePlayTs < 2000) return;
                    if (now - refs.current.lastSyncAppliedTs < 2000) return;
                    if (!refs.current.guestControls) {
                        // Guard against re-entrant pause loop
                        if (refs.current.forcingPause) return;
                        refs.current.forcingPause = true;
                        refs.current.ignoreNextOnPP = true; // suppress the pause event we're about to fire
                        Spicetify.Player.pause();
                        Spicetify.showNotification('🔒 Only the host can resume playback');
                        setTimeout(() => { refs.current.forcingPause = false; }, 500);
                        // Don't send SYNC here — it would cause host to reply PLAY{paused:false}
                        // which would make us try to play again → another onPP → loop.
                        // The drift interval (every 15s) will re-sync position organically.
                    } else {
                        // Guest with controls resumed — tell host our pos is in sync.
                        // Only send SYNC if we're on the right track; if on wrong track,
                        // snap back first (host PLAY reply will confirm position after snap).
                        const c = hostConn();
                        if (refs.current.targetUri) {
                            const curUri = Spicetify.Player.data?.item?.uri;
                            if (curUri && curUri !== refs.current.targetUri) {
                                // Wrong track — snap back. Suppress the resulting events.
                                refs.current.ignoreNextSongChange = true;
                                refs.current.ignoreNextOnPP = true;
                                refs.current.lastSyncAppliedTs = Date.now();
                                Spicetify.Player.playUri(refs.current.targetUri).catch(() => {
                                    refs.current.ignoreNextSongChange = false;
                                    refs.current.ignoreNextOnPP = false;
                                });
                                Spicetify.showNotification('🔒 Locked to Jam');
                            } else {
                                // Right track — request a position sync from host.
                                if (c?.open && now - refs.current.lastSyncRequestTs > 2500) {
                                    refs.current.lastSyncRequestTs = now;
                                    c.send({ type: 'SYNC' });
                                }
                            }
                        } else if (c?.open && now - refs.current.lastSyncRequestTs > 2500) {
                            refs.current.lastSyncRequestTs = now;
                            c.send({ type: 'SYNC' });
                        }
                    }
                }
            }
            }); // end Promise.resolve().then — wait for Spotify's state to settle
        };
        Spicetify.Player.addEventListener('songchange', onSong); 
        Spicetify.Player.addEventListener('onplaypause', onPP);
        let qi: ReturnType<typeof setInterval> | null = null;
        let driftI: ReturnType<typeof setInterval> | null = null;
        qi = refs.current.isHost ? setInterval(refreshQueue, 5000) : null;
        driftI = !refs.current.isHost ? setInterval(() => { 
            const now = Date.now();
            // Secondary safety check in case a heartbeat packet was dropped
            if (now - refs.current.remotePlayTs < 3000) return;
            if (now - refs.current.lastSyncAppliedTs < 3000) return;
            if (now - refs.current.lastSyncRequestTs < 5000) return;
            const c = hostConn(); 
            if (c?.open) {
                refs.current.lastSyncRequestTs = now;
                c.send({ type: 'SYNC' }); 
            }
        }, 6000) : null;
        return () => { 
            Spicetify.Player.removeEventListener('songchange', onSong); 
            Spicetify.Player.removeEventListener('onplaypause', onPP); 
            if (qi) clearInterval(qi); 
            if (driftI) clearInterval(driftI); 
        };
    }, [connected, isHost, broadcast, refreshQueue, hostConn, playNextInJamQueue]);

    // ── Context-menu "Add to Jam" item ─────────────────────────────────────
    // Kept in its own effect (deps = [connected] only) so the item is
    // registered exactly once per session — not torn down and re-created on
    // every addToQueue/refreshQueue closure change.  The callback delegates
    // through addToQueueRef.current so it always calls the latest version.
    // ── Context-menu "Add to Jam" item ─────────────────────────────────────
    // Registers ContextMenu item so it shows up in Spotify's track 3-dots menus
    // whenever connected to a Jam.
    useEffect(() => {
        let item: any = null;
        try {
            item = new (Spicetify as any).ContextMenu.Item(
                'Add to Jam',
                (uris: string[]) => addToQueueRef.current?.(uris),
                (uris: string[]) => {
                    if (!refs.current.connected) return false;
                    if (!uris || !uris.length) return false;
                    return uris.some(u => {
                        try {
                            return (Spicetify as any).URI?.isTrack(u) || u.includes(':track:');
                        } catch {
                            return u.includes(':track:');
                        }
                    });
                },
                'plus-alt'
            );
            item.register();
            ctxMenuItem.current = item;
        } catch (e) {
            console.warn('[Spicetify Jam] ContextMenu.Item registration failed', e);
        }
        return () => {
            try { item?.deregister(); } catch {}
            ctxMenuItem.current = null;
        };
    }, []);

    useEffect(() => {
        const hash = window.location.hash.slice(1);
        if (hash.startsWith('jam=')) { const id = hash.split('=')[1]; if (id) joinJam(id); }
    }, []);

    return (
        <Ctx.Provider value={{
            isHost, jamId, members, connected, error, nowPlaying, hostName, queue,
            guestControls, guestCreateSong, isPlaying, progress, duration, ping, updateAvailable,
            reconnecting, savedHostId, savedSession, resumeSession,
            startJam, joinJam, leaveJam, addToQueue, removeFromQueue,
            addCustomTrack, moveInQueue, requestSync, jumpToTrack, seekTo, kickMember,
            toggleGuestControls, toggleGuestCreateSong, play, pause, next, prev
        } as any}>
            {children}
        </Ctx.Provider>
    );
};

export const useJam = () => { const c = useContext(Ctx); if (!c) throw new Error('useJam must be inside JamProvider'); return c; };
