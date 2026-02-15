// utils/versionLoader.js
import fs from 'fs';
import path from 'path';

let cachedVersion = null;

export function getVersion() {
    if (cachedVersion) return cachedVersion;

    try {
        // Liest die version.txt im Hauptverzeichnis aus
        const versionPath = path.join(process.cwd(), 'version.txt');
        const version = fs.readFileSync(versionPath, 'utf8');
        cachedVersion = version.trim();
        return cachedVersion;
    } catch (err) {
        console.error("Fehler beim Laden der version.txt:", err);
        return "v0.0.0"; // Fallback
    }
}
