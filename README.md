# ComfortRoute Recorder v2

## Install/update
Upload the **contents** of this folder to the **root of the same GitHub Pages repository** (replace index.html, app.js, style.css, and icon.png if asked; add sw.js and manifest.webmanifest). GitHub Pages: Settings > Pages > Deploy from main / (root). Wait for deployment, then open the existing HTTPS URL on iPhone Safari. Refresh or close and reopen the Home Screen app to pick up the new service worker. Do NOT change the GitHub Pages origin/path if you want existing IndexedDB drive history to remain accessible.

## Features
- Manual Comfort / Comfort PLUS / Sport selection stored per trip and in exported CSV. The app does not detect the car setting.
- Automatic local storage of completed drives, plus checkpoints during recording. The map reads all saved trips automatically.
- OpenStreetMap or CARTO street basemaps, Leaflet GPS polylines colored by manually selected suspension mode. The map is not Google Maps. The map tiles require internet.
- Coverage: number of unique ~50 m latitude/longitude grid cells touched by accurate GPS points. This is a rough area coverage proxy, **not a number of roads or streets**, and not map-matched.
- Export all CSV files and combined GeoJSON tracks for external GIS analysis.
- Screen Wake Lock API request where supported. On iOS it may be unavailable, denied, or released, and does not permit background recording. No web app can guarantee GPS or motion tracking with a locked screen.

## Important
Data is in IndexedDB **on that device and website origin**. Nothing is synced to a server. Back up CSV regularly; private browsing, clearing Safari website data, or changing the website origin can remove access. Avoid handling the phone while driving. Mount rigidly in the same orientation. Phone-axis z RMS is experimental and should not be interpreted as calibrated passenger comfort. Compare speed, phone mounting and driving conditions, not just suspension mode.

Existing v1 trips remain readable in the same IndexedDB database. Older trips display as 'mode unknown'.


V2.1: Default street tiles now Esri World Street Map. Switch between Esri, OpenStreetMap and CARTO. Rebuilt service worker cache for iPhone updates. Data remains stored locally.
