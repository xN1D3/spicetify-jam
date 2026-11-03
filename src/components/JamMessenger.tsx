import React, { useState, useEffect, useRef } from 'react';
import { useJam, ChatMessage } from '../JamContext';

// Color palette for name-based avatars
const nameColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = ['#1db954', '#1ed760', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#e11d48'];
    return colors[Math.abs(hash) % colors.length];
};
const safeInitial = (name: string) => ((name || '?').trim()[0] || '?').toUpperCase();

// Mini Web Audio pop sound
function playSound(freq = 600) {
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    } catch (_) { }
}

export const JamMessenger: React.FC = () => {
    const j = useJam();
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [teaser, setTeaser] = useState<{ sender: string; text: string } | null>(null);
    const [popAnim, setPopAnim] = useState(false);
    const [recentMsgSender, setRecentMsgSender] = useState<{ name: string; image: string } | null>(null);
    const msgSenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const teaserTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const lastMsgCount = useRef(j.chatMessages.length);

    // Auto-scroll chat feed
    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 40);
    };

    // Close messenger when Jam sidebar closes/minimizes
    useEffect(() => {
        const handleSidebarClose = () => {
            setIsOpen(false);
            setTeaser(null);
        };
        window.addEventListener('jam:sidebar-closed', handleSidebarClose);
        return () => window.removeEventListener('jam:sidebar-closed', handleSidebarClose);
    }, []);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (msgSenderTimer.current) clearTimeout(msgSenderTimer.current);
            if (teaserTimer.current) clearTimeout(teaserTimer.current);
        };
    }, []);

    // Watch incoming messages
    useEffect(() => {
        if (j.chatMessages.length > lastMsgCount.current) {
            const latest = j.chatMessages[j.chatMessages.length - 1];
            if (!latest.isOutgoing) {
                playSound(720);
                setPopAnim(true);
                setTimeout(() => setPopAnim(false), 400);

                // Switch chat head to friend's avatar for 5 minutes
                setRecentMsgSender(latest.sender);
                if (msgSenderTimer.current) clearTimeout(msgSenderTimer.current);
                msgSenderTimer.current = setTimeout(() => {
                    setRecentMsgSender(null);
                }, 5 * 60 * 1000); // 5 minutes with no new messages -> switch back to vinyl

                if (!isOpen) {
                    if (teaserTimer.current) clearTimeout(teaserTimer.current);
                    setTeaser({ sender: latest.sender.name, text: latest.text });
                    teaserTimer.current = setTimeout(() => {
                        setTeaser(null);
                    }, 4000);
                } else {
                    // Window is already open, mark read immediately
                    j.markChatRead();
                }
            }
            scrollToBottom();
        }
        lastMsgCount.current = j.chatMessages.length;
    }, [j.chatMessages, isOpen]);

    // When opening
    const handleToggle = () => {
        if (!isOpen) {
            setIsOpen(true);
            setTeaser(null);
            j.markChatRead();
            scrollToBottom();
        } else {
            setIsOpen(false);
        }
    };

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;
        j.sendChatMessage(text);
        setInput('');
        playSound(500);
        scrollToBottom();
    };

    if (!j.connected) return null;

    const lastOutgoingIndex = j.chatMessages.reduce((lastIdx, m, idx) => m.isOutgoing ? idx : lastIdx, -1);

    return (
        <>
            {/* ── Circular Chat Head Docked Outside Bottom-Left of Jam Frame ── */}
            <div className="jam-chat-head-container">
                {/* Speech Bubble Teaser when collapsed */}
                {teaser && !isOpen && (
                    <div className="jam-chat-head-preview">
                        <span className="jam-preview-name">{teaser.sender}:</span>
                        <span className="jam-preview-text">{teaser.text}</span>
                    </div>
                )}

                <button
                    className={`jam-chat-head-btn${popAnim ? ' pop-anim' : ''}`}
                    onClick={handleToggle}
                    title={recentMsgSender ? `Chat with ${recentMsgSender.name}` : (j.nowPlaying ? `Now Playing: ${j.nowPlaying.title}` : 'Open Room Messenger')}
                >
                    {recentMsgSender ? (
                        // Friend Avatar Mode (Active when a friend messages, reverts to vinyl after 5 mins)
                        recentMsgSender.image ? (
                            <img
                                src={recentMsgSender.image}
                                className="jam-chat-head-avatar"
                                alt={recentMsgSender.name || "Friend Profile"}
                            />
                        ) : (
                            <div className="jam-chat-head-initial" style={{ background: nameColor(recentMsgSender.name) }}>
                                {safeInitial(recentMsgSender.name)}
                            </div>
                        )
                    ) : (
                        // Full Album Art Spinning Vinyl Record Mode
                        <div className={`jam-vinyl-disc${j.isPlaying ? '' : ' paused'}`}>
                            {j.nowPlaying?.artUrl ? (
                                <img
                                    src={j.nowPlaying.artUrl}
                                    className="jam-vinyl-full-art"
                                    alt={j.nowPlaying.title || 'Vinyl'}
                                    onError={(e) => {
                                        (e.target as HTMLElement).style.display = 'none';
                                    }}
                                />
                            ) : (
                                <div className="jam-vinyl-thumb-placeholder">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="12" r="10" />
                                    </svg>
                                </div>
                            )}
                            <div className="jam-vinyl-grooves" />
                            <div className="jam-vinyl-sheen" />
                            <div className="jam-vinyl-center-hole" />
                        </div>
                    )}

                    {/* Mini Facebook Messenger badge */}
                    <div className="jam-chat-head-mini-badge" title="Messenger">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.915 1.458 5.528 3.738 7.214V22l3.376-1.854c.907.251 1.875.388 2.886.388 5.523 0 10-4.145 10-9.258S17.523 2 12 2z" fill="#1db954" />
                            <path d="M6.5 13.5l4-4.5 2.5 2.5 4.5-4.5-4 4.5-2.5-2.5-4.5 4.5z" fill="#ffffff" />
                        </svg>
                    </div>

                    {/* Unread count badge */}
                    {j.unreadChatCount > 0 && !isOpen && (
                        <span className="jam-chat-head-badge">{j.unreadChatCount}</span>
                    )}
                </button>
            </div>

            {/* ── Floating Popup Messenger Window ── */}
            <div className={`jam-messenger-popup${isOpen ? ' open' : ''}`}>
                <div className="jam-m-header">
                    <div className="jam-m-header-left">
                        <div className="jam-m-avatar-group">
                            {recentMsgSender?.image ? (
                                <img
                                    src={recentMsgSender.image}
                                    className="jam-m-avatar-sm"
                                    alt="Active Friend"
                                />
                            ) : recentMsgSender?.name ? (
                                <div className="jam-m-avatar-initial sm" style={{ background: nameColor(recentMsgSender.name) }}>
                                    {safeInitial(recentMsgSender.name)}
                                </div>
                            ) : (
                                <div className="jam-m-avatar-sm" style={{ background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                        <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.915 1.458 5.528 3.738 7.214V22l3.376-1.854c.907.251 1.875.388 2.886.388 5.523 0 10-4.145 10-9.258S17.523 2 12 2z" fill="#1db954" />
                                        <path d="M6.5 13.5l4-4.5 2.5 2.5 4.5-4.5-4 4.5-2.5-2.5-4.5 4.5z" fill="#ffffff" />
                                    </svg>
                                </div>
                            )}
                            <span className="jam-m-online-indicator" />
                        </div>
                        <div>
                            <div className="jam-m-title">Jam Messenger</div>
                            <div className="jam-m-subtitle">{j.members.length} Listening · P2P Real-time</div>
                        </div>
                    </div>
                    <div className="jam-m-header-actions">
                        <button
                            className="jam-m-action-btn"
                            onClick={() => setIsOpen(false)}
                            title="Minimize to circle"
                        >
                            —
                        </button>
                    </div>
                </div>

                <div className="jam-m-messages">
                    {j.chatMessages.length === 0 && (
                        <div className="jam-m-empty">
                            <span>💬 No messages</span>
                            <p>Send a message to everyone listening in the room!</p>
                        </div>
                    )}

                    {j.chatMessages.map((msg, i) => {
                        const isMe = msg.isOutgoing;
                        const timeStr = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return (
                            <div key={msg.id} className={`jam-m-msg${isMe ? ' outgoing' : ' incoming'}`}>
                                {!isMe && (
                                    msg.sender.image ? (
                                        <img
                                            src={msg.sender.image}
                                            className="jam-m-msg-avatar"
                                            alt={msg.sender.name}
                                        />
                                    ) : (
                                        <div className="jam-m-avatar-initial" style={{ background: nameColor(msg.sender.name) }}>
                                            {safeInitial(msg.sender.name)}
                                        </div>
                                    )
                                )}
                                <div className="jam-m-msg-body">
                                    <div className={`jam-m-msg-header${isMe ? ' right' : ''}`}>
                                        <span className="jam-m-msg-sender">{isMe ? 'You' : msg.sender.name}</span>
                                        <span className="jam-m-msg-time">{timeStr}</span>
                                    </div>
                                    <div className="jam-m-bubble">{msg.text}</div>
                                    {isMe && i === lastOutgoingIndex && msg.isRead && (
                                        <div className="jam-m-seen">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            <span>Seen {msg.readBy && msg.readBy.length > 0 ? `by ${msg.readBy.join(', ')}` : ''}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                <div className="jam-m-input-dock">
                    <form className="jam-m-form" onSubmit={handleSend}>
                        <input
                            type="text"
                            placeholder="Message listening room..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            maxLength={300}
                            autoFocus
                        />
                        <button type="submit" className="jam-m-send-btn" title="Send message">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13" />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
};

export default JamMessenger;
