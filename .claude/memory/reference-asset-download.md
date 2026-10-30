---
name: reference-asset-download
description: How third-party assets were fetched (OGA direct links, itch.io free download flow)
metadata:
  type: reference
---

- OpenGameArt: scrape `https://opengameart.org/<path>` for `sites/default/files/*.zip|ogg|mp3` links; license is on the page.
- itch.io free assets: GET page with cookie jar -> csrf_token; POST `<page>/download_url` -> JSON url; GET it, find `data-upload_id`; POST `<page>/file/<id>?source=view_game&as_props=1` -> JSON url; download. kenney.nl direct media links return 403 (use the OGA mirror).
- Not playable in browsers / skipped: `.aif` (Level up pack), `.7z` (wet squish; no extractor installed).
- Audio/fonts currently in `public/assets/`; keep CREDITS.md rows in sync.
