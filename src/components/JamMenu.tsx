import React, { useState, useEffect } from 'react';
import { useJam } from '../JamContext';
import QRCode from 'qrcode';

const COLORS = [
    'linear-gradient(135deg,#1db954,#1ed760)',
    'linear-gradient(135deg,#e84444,#ff6b6b)',
    'linear-gradient(135deg,#4a90d9,#6eb5ff)',
    'linear-gradient(135deg,#f5a623,#ffc857)',
    'linear-gradient(135deg,#b24592,#f15f79)',
    'linear-gradient(135deg,#00c9ff,#92fe9d)',
];

// Stable colour per name so the same person always gets the same colour
const nameColor = (name: string) => COLORS[Math.abs(name.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) % COLORS.length];

const I = {
    minimize: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    expand: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>,
    people: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM4 4.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM10.5 3a2 2 0 100 4 2 2 0 000-4z" /></svg>,
    copy: <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6.5V12a1.5 1.5 0 001.5 1.5H10A1.5 1.5 0 0011.5 12V6.5A1.5 1.5 0 0010 5H5.5A1.5 1.5 0 004 6.5z" /><path d="M6.5 1A1.5 1.5 0 005 2.5V4h1V2.5a.5.5 0 01.5-.5H10a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H9v1h1a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0010 1H6.5z" /></svg>,
    check: <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M13.985 2.383L5.127 12.754 1.388 8.375l-.766.663 4.5 5.2 9.638-11.29-.766-.654z" /></svg>,
    qr: <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h6v6H1V1zm2 2v2h2V3H3zm6-2h6v6H9V1zm2 2v2h2V3h-2zM1 9h6v6H1V9zm2 2v2h2v-2H3z" /></svg>,
    leave: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H7v-1H3.5a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5H7V2H3.5zM10.354 4.646a.5.5 0 00-.708.708L12.293 8H6v1h6.293l-2.647 2.646a.5.5 0 10.708.708l3.5-3.5a.5.5 0 000-.708l-3.5-3.5z" /></svg>,
    jam: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" /></svg>,
    warn: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
    kick: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="17" y1="8" x2="22" y2="13" /><line x1="22" y1="8" x2="17" y2="13" /></svg>,
    queue: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
    prev: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>,
    next: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6z" /></svg>,
    play: <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
    pause: <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
    settings: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
    x: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
    link: <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4.715 6.542L3.343 7.914a3 3 0 104.243 4.243l1.828-1.829A3 3 0 008.586 5.5L8 6.086a1 1 0 00-.154.199 2 2 0 01.861 3.337L6.88 11.45a2 2 0 11-2.83-2.827l.793-.793a4.018 4.018 0 01-.128-1.287z" /></svg>,
    playItem: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
    drag: <svg width="10" height="13" viewBox="0 0 12 18" fill="rgba(255,255,255,0.2)"><circle cx="4" cy="3" r="1.8" /><circle cx="9" cy="3" r="1.8" /><circle cx="4" cy="9" r="1.8" /><circle cx="9" cy="9" r="1.8" /><circle cx="4" cy="15" r="1.8" /><circle cx="9" cy="15" r="1.8" /></svg>,
    // Chevron for collapsible sections
    chevronDown: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>,
    chevronUp: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>,
    resume: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>,
    chat: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
    plus: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    clock: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    folder: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>,
};

const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};
const safeInitial = (name: string) => ((name || '?').trim()[0] || '?').toUpperCase();

// ── Mini Widget (rendered into #jam-mini) ────
export const JamMiniWidget: React.FC<{ onExpand: () => void }> = ({ onExpand }) => {
    const j = useJam();
    if (!j.connected) return null;

    const visibleMembers = j.members.slice(0, 3);
    const extraCount = j.members.length - 3;

    return (
        <div className="jam-mini-widget" onClick={onExpand} title="Click to expand Jam">
            {/* Album art with live dot */}
            <div className="jam-mini-art">
                {j.nowPlaying?.artUrl
                    ? <img src={j.nowPlaying.artUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <div className="jam-mini-art-ph">{I.jam}</div>
                }
                <div className="jam-mini-live-dot" />
            </div>

            {/* Track info */}
            <div className="jam-mini-info">
                <div className="jam-mini-title">{j.nowPlaying?.title || 'Jam Active'}</div>
                <div className="jam-mini-sub">
                    {j.isHost ? `Hosting · ${j.members.length} listening` : `With ${j.hostName}`}
                </div>
            </div>

            {/* Member avatars */}
            {visibleMembers.length > 0 && (
                <div className="jam-mini-avatars">
                    {extraCount > 0 && (
                        <div className="jam-mini-avatar" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '7px', fontFamily: 'Inter, sans-serif', fontWeight: 800 }}>
                            +{extraCount}
                        </div>
                    )}
                    {[...visibleMembers].reverse().map((m, i) => (
                        <div key={m.id} className="jam-mini-avatar" style={{ background: nameColor(m.name) }}>
                            {m.image
                                ? <img src={m.image} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                : safeInitial(m.name)
                            }
                        </div>
                    ))}
                </div>
            )}

            {/* Expand icon */}
            <button
                className="jam-mini-expand-btn"
                onClick={e => { e.stopPropagation(); onExpand(); }}
                title="Open Jam"
            >
                {I.expand}
            </button>
        </div>
    );
};

// ── Mini "added by" avatar shown inside queue rows ────
const AddedByAvatar: React.FC<{ name: string; image: string }> = ({ name, image }) => (
    <div
        className="jam-added-by-avatar"
        title={`Added by ${name}`}
        style={{ background: nameColor(name) }}
    >
        {image
            ? <img src={image} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : safeInitial(name)
        }
    </div>
);

// ── Main Panel ───────────────────────────────
const JamMenu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const j = useJam();
    const [joinInput, setJoinInput] = useState(() => {
        try {
            const hash = window.location.hash;
            if (hash.includes('jam=')) return hash.split('jam=')[1];
        } catch { }
        return j.savedSession?.role === 'guest' ? j.savedSession.jamId : '';
    });
    const [qrUrl, setQrUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    // Listeners panel is open by default; user can collapse it
    const [listenersOpen, setListenersOpen] = useState(true);
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [customTitle, setCustomTitle] = useState('');
    const [customArtist, setCustomArtist] = useState('');
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [isAddingFiles, setIsAddingFiles] = useState(false);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [customHostCode, setCustomHostCode] = useState(() => {
        try {
            return localStorage.getItem('jam_custom_host_code') || '';
        } catch {
            return '';
        }
    });
    const [recentRooms, setRecentRooms] = useState<{ jamId: string; hostName?: string; ts: number }[]>(() => {
        try {
            const raw = localStorage.getItem('jam_recent_rooms');
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        try {
            const raw = localStorage.getItem('jam_recent_rooms');
            if (raw) setRecentRooms(JSON.parse(raw));
        } catch { }
    }, [j.connected]);

    const handleCustomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
        setCustomHostCode(clean);
        try {
            localStorage.setItem('jam_custom_host_code', clean);
        } catch { }
    };

    const handleRemoveRecentRoom = (e: React.MouseEvent, jamId: string) => {
        e.stopPropagation();
        const updated = recentRooms.filter(r => r.jamId.toUpperCase() !== jamId.toUpperCase());
        setRecentRooms(updated);
        try {
            localStorage.setItem('jam_recent_rooms', JSON.stringify(updated));
        } catch { }
    };

    const handleAddCustom = () => {
        if (!customTitle.trim()) return;
        j.addCustomTrack(customTitle.trim(), customArtist.trim());
        setCustomTitle('');
        setCustomArtist('');
        setShowCustomForm(false);
    };

    const handlePickLocalFiles = () => {
        fileInputRef.current?.click();
    };

    const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setIsAddingFiles(true);
        try {
            for (let i = 0; i < files.length; i++) {
                await j.addLocalFileTrack(files[i]);
            }
        } finally {
            setIsAddingFiles(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    useEffect(() => {
        if (j.jamId) {
            QRCode.toDataURL(j.jamId, { width: 200, margin: 1, color: { dark: '#000', light: '#fff' } }).then(setQrUrl);
        }
    }, [j.jamId]);

    const copy = (text: string, msg: string) => {
        try { (Spicetify as any).Platform.ClipboardAPI.copy(text); } catch { navigator.clipboard?.writeText(text); }
        Spicetify.showNotification(msg);
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!j.isHost && !j.guestControls) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        j.seekTo(pct * j.duration);
    };

    const pct = j.duration > 0 ? (j.progress / j.duration) * 100 : 0;
    const canEdit = j.isHost || j.guestControls;
    const canCreateSong = j.isHost || j.guestCreateSong;

    useEffect(() => {
        if (!canCreateSong && showCustomForm) {
            setShowCustomForm(false);
        }
    }, [canCreateSong, showCustomForm]);

    if (!j.connected) {
        return (
            <div className="jam-root">
                <div className="jam-header">
                    <div className="jam-header-left">
                        <div className="jam-logo-icon">{I.jam}</div>
                        <div>
                            <div className="jam-title">Spicetify Jam</div>
                            <div className="jam-subtitle">Listen together, in sync</div>
                        </div>
                    </div>
                    {/* Minimize (−) button — distinct from Spotify's X button */}
                    <div className="jam-header-right">
                        <button className="jam-minimize-btn" onClick={onClose} title="Minimize">
                            {I.minimize}
                        </button>
                    </div>
                </div>
                <div className="jam-body">
                    {j.updateAvailable && (
                        <div className="jam-error" style={{ background: 'rgba(29,185,84,0.08)', borderColor: 'rgba(29,185,84,0.2)', color: '#1db954', cursor: 'pointer' }}
                            onClick={() => window.open('https://github.com/xN1D3/spicetify-jam', '_blank')}>
                            <span>✨</span>
                            <span style={{ fontSize: '12px', fontWeight: 700 }}>✨ Update Available — tap to update app</span>
                        </div>
                    )}
                    <div className="jam-hero">
                        <div className="jam-hero-icon">{I.jam}</div>
                        <h2 className="jam-hero-title">Host a Listening Session</h2>
                        <p className="jam-hero-desc">Sync Spotify playback with friends in real‑time via P2P — no accounts needed.</p>
                    </div>
                    {j.savedSession && (
                        <button
                            className="jam-btn green full"
                            style={{
                                marginBottom: 8,
                                background: 'linear-gradient(135deg, #1db954, #1ed760)',
                                color: '#000',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8
                            }}
                            onClick={() => j.resumeSession()}
                        >
                            {I.resume}
                            <span>
                                {j.savedSession.role === 'host'
                                    ? `Resume Session (${j.savedSession.jamId}) · Host`
                                    : `Rejoin Session (${j.savedSession.jamId}) · With ${j.savedSession.hostName || 'Host'}`}
                            </span>
                        </button>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input
                            className="jam-input"
                            placeholder="Room Code (optional, e.g. ABC123)"
                            value={customHostCode}
                            onChange={handleCustomCodeChange}
                            spellCheck={false}
                        />
                        <button
                            className={`jam-btn ${j.savedSession ? 'outline' : 'green'} full`}
                            onClick={() => j.startJam(customHostCode.trim() || undefined)}
                        >
                            {customHostCode.trim() ? `Start Jam as "${customHostCode.trim()}"` : 'Start a new Jam'}
                        </button>
                    </div>

                    <div className="jam-divider"><div className="jam-divider-line" /><span>or join one</span><div className="jam-divider-line" /></div>
                    <input className="jam-input" placeholder="Paste Jam ID or join link…" value={joinInput}
                        onChange={e => setJoinInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && j.joinJam(joinInput)} spellCheck={false} />
                    <button className="jam-btn outline full" style={{ marginTop: 4 }} onClick={() => j.joinJam(joinInput)}>Join Session</button>

                    {recentRooms.length > 0 && (
                        <div className="jam-recent-section">
                            <div className="jam-divider" style={{ marginTop: 14, marginBottom: 8 }}>
                                <div className="jam-divider-line" />
                                <span style={{ fontSize: 9, letterSpacing: '1.2px', textTransform: 'uppercase', opacity: 0.45, fontWeight: 800 }}>Recent Rooms</span>
                                <div className="jam-divider-line" />
                            </div>
                            <div className="jam-recent-list">
                                {recentRooms.map((r, i) => (
                                    <div
                                        key={`${r.jamId}-${i}`}
                                        className="jam-recent-card"
                                        onClick={() => j.joinJam(r.jamId)}
                                        title={`Click to join ${r.jamId}`}
                                    >
                                        <div className="jam-recent-icon">{I.clock}</div>
                                        <div className="jam-recent-info">
                                            <div className="jam-recent-id">{r.jamId}</div>
                                            {r.hostName && <div className="jam-recent-host">Host: {r.hostName}</div>}
                                        </div>
                                        <button
                                            className="jam-recent-del"
                                            onClick={e => handleRemoveRecentRoom(e, r.jamId)}
                                            title="Remove from history"
                                        >
                                            {I.x}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {j.error && <div className="jam-error">{I.warn} {j.error}</div>}
                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                        Enjoying Jam? <a href="https://github.com/xN1D3/spicetify-jam" target="_blank" style={{ color: '#1db954', textDecoration: 'none' }}>⭐ Star us on GitHub</a>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="jam-root">
            <div className="jam-header">
                <div className="jam-header-left">
                    <div className="jam-logo-icon active">{I.jam}</div>
                    <div style={{ minWidth: 0 }}>
                        <div className="jam-title">Jam</div>
                        <div className="jam-subtitle">{j.isHost ? `Hosting · ${j.members.length} listening · Room: ${j.jamId}` : `With ${j.hostName} · Room: ${j.jamId}`}</div>
                    </div>
                </div>
                <div className="jam-header-right">
                    {!j.isHost && (
                        <span className={`jam-ping ${j.ping < 0 ? 'measuring' : j.ping > 150 ? 'bad' : 'good'}`}>
                            {j.ping < 0 ? '…' : `${j.ping}ms`}
                        </span>
                    )}
                    {/* Minimize button — uses a "−" icon, not an X, to avoid confusion with Spotify's close */}
                    <button className="jam-minimize-btn" onClick={onClose} title="Minimize to mini player">
                        {I.minimize}
                    </button>
                </div>
            </div>

            <div className="jam-body scrollable">
                {j.updateAvailable && (
                    <div className="jam-error" style={{ background: 'rgba(29,185,84,0.08)', borderColor: 'rgba(29,185,84,0.2)', color: '#1db954', cursor: 'pointer' }}
                        onClick={() => window.open('https://github.com/xN1D3/spicetify-jam', '_blank')}>
                        <span>✨</span>
                        <span style={{ fontSize: '12px', fontWeight: 700 }}>✨ Update Available — tap to update app</span>
                    </div>
                )}

                <div className={`jam-live-badge${j.reconnecting ? ' disconnected' : ''}`}>
                    <span className="jam-live-dot" />
                    <span>{j.reconnecting ? 'Host disconnected, reconnecting...' : 'Session Active'}</span>
                    <span className="jam-badge">{j.isHost ? 'HOST' : 'GUEST'}</span>
                </div>

                {j.nowPlaying && (
                    <div className="jam-np-card">
                        <div className="jam-np-art-wrap">
                            {j.nowPlaying.artUrl
                                ? <img className="jam-np-art" src={j.nowPlaying.artUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                : <div className="jam-np-art placeholder" />}
                            <div className="jam-np-art-overlay" />
                        </div>
                        <div className="jam-np-meta">
                            <div className="jam-np-label">
                                {j.nowPlaying.isLocalAudio || j.nowPlaying.uri?.startsWith('jam:local:') ? (
                                    <span className="jam-np-local-badge">
                                        📁 Local Audio (0% Ads)
                                    </span>
                                ) : (
                                    'Now Playing'
                                )}
                            </div>
                            <div className="jam-np-title">{j.nowPlaying.title}</div>
                            <div className="jam-np-artist">{j.nowPlaying.artist}</div>
                        </div>
                        <div className="jam-progress-row">
                            <span className="jam-time">{fmtTime(j.progress)}</span>
                            <div className="jam-progress-rail"
                                onClick={handleSeek}
                                style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                                <div className="jam-progress-fill" style={{ width: `${pct}%` }} />
                                <div className="jam-progress-dot" style={{ left: `${pct}%` }} />
                            </div>
                            <span className="jam-time">{fmtTime(j.duration)}</span>
                        </div>
                        {canEdit && (
                            <div className="jam-controls">
                                <button className="jam-ctrl-btn" onClick={j.prev}>{I.prev}</button>
                                <button className="jam-ctrl-btn main" onClick={j.isPlaying ? j.pause : j.play}>
                                    {j.isPlaying ? I.pause : I.play}
                                </button>
                                <button className="jam-ctrl-btn" onClick={j.next}>{I.next}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── LISTENERS — always at the top, collapsible ── */}
                <div className="jam-section-card">
                    {/* Clickable header toggles open/closed */}
                    <button
                        className="jam-section-title jam-collapsible-header"
                        onClick={() => setListenersOpen(v => !v)}
                        aria-expanded={listenersOpen}
                    >
                        <span className="jam-section-title-inner">
                            {I.people} Listeners · {j.members.length}
                        </span>
                        <span className="jam-chevron">
                            {listenersOpen ? I.chevronUp : I.chevronDown}
                        </span>
                    </button>

                    {listenersOpen && (
                        <div className="jam-listeners-body">
                            {j.members.map((m, i) => (
                                <div key={m.id + i} className="jam-member-row">
                                    <div className="jam-avatar" style={{ background: nameColor(m.name) }}>
                                        {m.image
                                            ? <img src={m.image} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                            : safeInitial(m.name)}
                                    </div>
                                    <div className="jam-member-info">
                                        <div className="jam-member-name">{m.name || 'Listener'}</div>
                                        {(() => {
                                            const isHostMember = !!m.isHost;
                                            const isDisconnected = isHostMember
                                                ? (!j.isHost && j.reconnecting)
                                                : (m.status === 'reconnecting' || m.status === 'disconnected');

                                            return (
                                                <div className={`jam-member-status ${isDisconnected ? 'disconnected' : 'active'}`}>
                                                    <span className={`jam-status-dot ${isDisconnected ? 'disconnected' : 'active'}`} />
                                                    <span>
                                                        {isHostMember
                                                            ? (isDisconnected ? 'Host · Reconnecting...' : 'Host')
                                                            : (isDisconnected ? 'Listener · Reconnecting...' : 'Listener')}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    {j.isHost && !m.isHost && (
                                        <button className="jam-icon-btn red" onClick={() => j.kickMember(m.id)}>{I.kick}</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {j.isHost && (
                    <div className="jam-section-card">
                        <div className="jam-section-title">{I.settings} Session Settings</div>
                        <div className="jam-setting-row">
                            <span>Guest Playback Controls</span>
                            <button className={`jam-toggle ${j.guestControls ? 'on' : ''}`} onClick={j.toggleGuestControls}>
                                <div className="jam-toggle-knob" />
                            </button>
                        </div>
                        <div className="jam-setting-row">
                            <span>Create Song</span>
                            <button className={`jam-toggle ${j.guestCreateSong ? 'on' : ''}`} onClick={j.toggleGuestCreateSong}>
                                <div className="jam-toggle-knob" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="jam-section-card">
                    <div className="jam-section-title">{j.isHost ? 'Invite' : 'Room Info'}</div>
                    <div className="jam-id-row">
                        <span className="jam-id-code">{j.jamId}</span>
                        <button
                            className={`jam-icon-btn ${copied ? 'green' : ''}`}
                            onClick={() => { copy(j.jamId, 'Copied!'); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        >{copied ? I.check : I.copy}</button>
                    </div>
                    <div className="jam-share-row">
                        <button className="jam-btn outline flex-1"
                            onClick={() => copy(`${window.location.origin}${window.location.pathname}#jam=${j.jamId}`, 'Link copied!')}>
                            {I.link} Copy Link
                        </button>
                        <button className="jam-btn outline flex-1" onClick={() => setShowQr(v => !v)}>
                            {I.qr} {showQr ? 'Hide QR' : 'QR Code'}
                        </button>
                    </div>
                    {showQr && qrUrl && (
                        <div className="jam-qr-box">
                            <img src={qrUrl} alt="QR" />
                            <div className="jam-qr-label">Scan to join</div>
                        </div>
                    )}
                </div>

                {/* ── QUEUE ── */}
                <div
                    className={`jam-section-card${isDraggingFile ? ' jam-drop-active' : ''}`}
                    onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('Files')) {
                            e.preventDefault();
                            setIsDraggingFile(true);
                        }
                    }}
                    onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        setIsDraggingFile(false);
                    }}
                    onDrop={async (e) => {
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            e.preventDefault();
                            setIsDraggingFile(false);
                            const files = Array.from(e.dataTransfer.files);
                            const audioFiles = files.filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(f.name));
                            if (audioFiles.length > 0) {
                                setIsAddingFiles(true);
                                try {
                                    for (const f of audioFiles) {
                                        await j.addLocalFileTrack(f);
                                    }
                                } finally {
                                    setIsAddingFiles(false);
                                }
                            } else {
                                Spicetify.showNotification('กรุณาวางไฟล์เพลง (.mp3, .wav, .flac, .m4a)', true);
                            }
                        }
                    }}
                >
                    <div className="jam-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span className="jam-section-title-inner">{I.queue} Up Next · {j.queue.length}</span>
                        {canCreateSong && (
                            <button
                                className={`jam-q-add-btn ${showCustomForm ? 'active' : ''}`}
                                onClick={() => setShowCustomForm(v => !v)}
                                title={showCustomForm ? 'Close' : 'Create Song'}
                            >
                                {showCustomForm ? I.x : I.plus}
                            </button>
                        )}
                    </div>

                    {/* ── Local Audio File Picker Bar ── */}
                    {canCreateSong && (
                        <div className="jam-local-bar">
                            <input
                                type="file"
                                ref={fileInputRef}
                                style={{ display: 'none' }}
                                accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac"
                                multiple
                                onChange={handleFilesSelected}
                            />
                            <button
                                className="jam-local-btn"
                                onClick={handlePickLocalFiles}
                                disabled={isAddingFiles}
                                title="เลือกไฟล์เพลงในเครื่อง หรือลากไฟล์มาวางตรงนี้ได้เลย (.mp3, .wav, .flac, .m4a)"
                            >
                                <span className="jam-local-icon">{I.folder}</span>
                                <span>{isAddingFiles ? 'กำลังโหลดไฟล์...' : '📁 เลือกไฟล์เพลง หรือลากมาวาง (Drag & Drop)'}</span>
                            </button>
                        </div>
                    )}

                    {showCustomForm && (
                        <div className="jam-custom-form">
                            <div className="jam-custom-form-title">💬 Create Fake Song (Chat in Queue)</div>
                            <input
                                className="jam-input"
                                style={{ marginBottom: 6, fontSize: 12, padding: '7px 10px' }}
                                placeholder="Song Title / Message"
                                value={customTitle}
                                onChange={e => setCustomTitle(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }}
                                autoFocus
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                    className="jam-input"
                                    style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
                                    placeholder="Artist name (optional)"
                                    value={customArtist}
                                    onChange={e => setCustomArtist(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }}
                                />
                                <button
                                    className="jam-btn green"
                                    style={{ fontSize: 11, padding: '6px 14px', whiteSpace: 'nowrap', fontWeight: 700 }}
                                    onClick={handleAddCustom}
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    )}

                    {j.queue.length === 0 && !showCustomForm && (
                        <div style={{ textAlign: 'center', padding: '16px 8px', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                            {canCreateSong
                                ? <>คิวว่าง · ลากไฟล์เพลง (.mp3) มาวาง หรือเพิ่มเพลง Spotify ได้เลย</>
                                : 'Queue is empty'}
                        </div>
                    )}

                    {j.queue.map((t, i) => (
                        <div
                            key={`${t.uri}-${i}`}
                            className={`jam-q-row${dragIdx === i ? ' drag-src' : ''}${dragOverIdx === i && dragIdx !== i ? ' drag-over' : ''}${t.isCustom || t.uri?.startsWith('jam:fake:') ? ' jam-q-fake-row' : ''}${t.isLocalAudio || t.uri?.startsWith('jam:local:') ? ' jam-q-local-row' : ''}`}
                            draggable={canEdit}
                            onDragStart={() => setDragIdx(i)}
                            onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                            onDrop={() => { if (dragIdx !== null && dragIdx !== i) j.moveInQueue(dragIdx, i); setDragIdx(null); setDragOverIdx(null); }}
                            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                            onDoubleClick={() => {
                                if (canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:')) {
                                    j.jumpToTrack(t.uri!);
                                }
                            }}
                            title={canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:') ? 'Double-click to play now' : undefined}
                        >
                            {canEdit && <div className="jam-drag-grip">{I.drag}</div>}
                            <div className="jam-q-num">{i + 1}</div>
                            <div
                                className="jam-q-thumb"
                                onClick={() => {
                                    if (canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:')) {
                                        j.jumpToTrack(t.uri!);
                                    }
                                }}
                                style={{ cursor: canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:') ? 'pointer' : undefined }}
                                title={canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:') ? 'Click to play' : undefined}
                            >
                                {t.isCustom || t.uri?.startsWith('jam:fake:') ? (
                                    <div className="jam-q-thumb-fake">
                                        {I.chat}
                                    </div>
                                ) : (t.isLocalAudio || t.uri?.startsWith('jam:local:')) ? (
                                    <div className="jam-q-thumb-local" title="Local Audio File">
                                        {I.folder}
                                    </div>
                                ) : t.artUrl ? (
                                    <div className="jam-q-thumb-wrap">
                                        <img src={t.artUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    </div>
                                ) : (
                                    <div className="jam-q-thumb-ph" />
                                )}
                            </div>
                            <div className="jam-q-meta">
                                <div
                                    className="jam-q-title"
                                    onClick={() => {
                                        if (canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:')) {
                                            j.jumpToTrack(t.uri!);
                                        }
                                    }}
                                    style={{ cursor: canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:') ? 'pointer' : undefined }}
                                    title={canEdit && !t.isCustom && !t.uri?.startsWith('jam:fake:') ? 'Click to play' : undefined}
                                >
                                    {t.title}
                                    {(t.isLocalAudio || t.uri?.startsWith('jam:local:')) && (
                                        <span className="jam-local-badge">Local</span>
                                    )}
                                </div>
                                {(t.artist || t.addedBy) && (
                                    <div className="jam-q-artist-row">
                                        {t.artist ? <span className="jam-q-artist">{t.artist}</span> : null}
                                        {/* Mini avatar showing who added this track */}
                                        {t.addedBy && (
                                            <AddedByAvatar
                                                name={t.addedBy.name}
                                                image={t.addedBy.image}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                            {canEdit && (
                                <div className="jam-q-btns">
                                    {!t.isCustom && !t.uri?.startsWith('jam:fake:') && (
                                        <button className="jam-q-btn green" title="Play now" onClick={() => j.jumpToTrack(t.uri!)}>{I.playItem}</button>
                                    )}
                                    <button className="jam-q-btn red" title="Remove" onClick={() => j.removeFromQueue(t.uri!, t.uid)}>{I.x}</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="jam-footer">
                {!j.isHost && (
                    <button className="jam-btn outline full" onClick={j.requestSync}>
                        Sync to Host
                    </button>
                )}
                <button className="jam-btn red full" onClick={j.leaveJam}>
                    {I.leave} {j.isHost ? 'End Jam' : 'Leave Jam'}
                </button>
            </div>
        </div>
    );
};

export default JamMenu;
