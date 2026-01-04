/**
 * Post-build script to patch the OpenNext worker for proper audio streaming.
 *
 * The issue: OpenNext's worker routes all requests through middleware,
 * which doesn't properly handle Range requests needed for audio streaming.
 *
 * The fix: Intercept requests for static audio files and serve them
 * directly from the ASSETS binding with proper Range header support.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const workerPath = join(process.cwd(), '.open-next', 'worker.js');

const audioHandler = `
            // Handle audio files with proper Range request support for streaming
            if (url.pathname.startsWith("/audio/") && url.pathname.endsWith(".mp3")) {
                const assetResponse = await env.ASSETS?.fetch(new URL(url.pathname, url.origin));
                if (assetResponse && assetResponse.ok) {
                    const rangeHeader = request.headers.get("Range");

                    if (rangeHeader) {
                        // Handle Range request for audio seeking/streaming
                        const bytes = rangeHeader.replace("bytes=", "").split("-");
                        const start = parseInt(bytes[0], 10);
                        const originalBody = await assetResponse.arrayBuffer();
                        const total = originalBody.byteLength;
                        const end = bytes[1] ? parseInt(bytes[1], 10) : total - 1;
                        const chunk = originalBody.slice(start, end + 1);

                        return new Response(chunk, {
                            status: 206,
                            headers: {
                                "Content-Type": "audio/mpeg",
                                "Content-Range": \`bytes \${start}-\${end}/\${total}\`,
                                "Content-Length": String(chunk.byteLength),
                                "Accept-Ranges": "bytes",
                                "Cache-Control": "public, max-age=31536000, immutable"
                            }
                        });
                    }

                    // Return full file with streaming headers
                    return new Response(assetResponse.body, {
                        status: 200,
                        headers: {
                            "Content-Type": "audio/mpeg",
                            "Accept-Ranges": "bytes",
                            "Cache-Control": "public, max-age=31536000, immutable"
                        }
                    });
                }
            }
`;

try {
    let workerContent = readFileSync(workerPath, 'utf-8');

    // Check if already patched
    if (workerContent.includes('Handle audio files with proper Range request support')) {
        console.log('✓ Worker already patched for audio streaming');
        process.exit(0);
    }

    // Insert the audio handler after the image loader handling
    const insertPoint = '// - `Request`s are handled by the Next server';

    if (!workerContent.includes(insertPoint)) {
        console.error('✗ Could not find insertion point in worker.js');
        process.exit(1);
    }

    workerContent = workerContent.replace(
        insertPoint,
        audioHandler + '\n            ' + insertPoint
    );

    writeFileSync(workerPath, workerContent);
    console.log('✓ Worker patched for audio streaming with Range request support');
} catch (error) {
    console.error('✗ Failed to patch worker:', error.message);
    process.exit(1);
}
