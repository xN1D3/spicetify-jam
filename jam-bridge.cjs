// Jam Audio Bridge - Local High-Speed YouTube Audio Extractor
// Bypasses browser CORS & delivers direct GoogleVideo Opus/AAC audio streams with 0% Ads

const http = require('http');
const { Ytdl, chooseFormat } = require('@distube/ytdl-core');

const PORT = process.env.PORT || 8765;
const ytdl = new Ytdl();

// Cache resolved audio streams in memory (valid for 4 hours)
const cache = new Map();

const server = http.createServer(async (req, res) => {
    // Enable CORS for Spotify
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    if (url.pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bridge: 'spicetify-jam-audio' }));
        return;
    }

    if (url.pathname === '/audio') {
        const id = url.searchParams.get('id');
        if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id query parameter' }));
            return;
        }

        // Check cache
        const cached = cache.get(id);
        if (cached && Date.now() < cached.expiresAt) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ url: cached.url, durationMs: cached.durationMs, fromCache: true }));
            return;
        }

        try {
            let audio = null;
            try {
                audio = chooseFormat(info.formats, {
                    filter: { hasAudio: true, hasVideo: false },
                    quality: 'highestaudio'
                });
            } catch {}

            if (!audio || !audio.url) {
                // Secondary check: any format with audio
                const audios = (info.formats || []).filter(f => f.hasAudio && f.url);
                if (audios.length) {
                    audio = audios.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
                }
            }

            if (!audio || !audio.url) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No audio format found' }));
                return;
            }

            const durationMs = parseInt(audio.approxDurationMs || '0', 10) 
                            || Math.round((info.videoDetails?.lengthSeconds || 0) * 1000);

            const result = {
                url: audio.url,
                durationMs,
                title: info.videoDetails?.title || '',
                expiresAt: Date.now() + 4 * 3600 * 1000
            };

            cache.set(id, result);
            console.log(`[Jam Bridge] Successfully resolved: "${result.title}" (${Math.round(durationMs / 1000)}s)`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ url: audio.url, durationMs, title: result.title }));
        } catch (err) {
            console.error(`[Jam Bridge] Error resolving ${id}:`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    res.writeHead(404).end('Not found');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[Jam Bridge] Port ${PORT} is already in use by another bridge instance.`);
        process.exit(0);
    } else {
        console.error('[Jam Bridge] Server error:', err);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n======================================================`);
    console.log(`  🎵 Spicetify Jam Audio Bridge is RUNNING on http://127.0.0.1:${PORT}`);
    console.log(`  ⚡ Status: Ready to stream YouTube audio with ZERO ADS`);
    console.log(`======================================================\n`);
});
