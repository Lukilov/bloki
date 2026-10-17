# Bloki

A self-hosted, Notion-style workspace for personal use: pages, databases, sharing and live co-editing. No paid tiers, no AI.
Your data is one SQLite file in `data/bloki.db`, and uploads go in `data/files/`.

```bash
npm install
npm run build
npm start          # http://localhost:4321
```

The first account you create owns the workspace; everyone after that joins through an invite link.
Development: `npm run dev` (API on :4321, Vite on :5173). Tests: `npm test`. Back up by copying the `data/` folder.

By default the server only listens on this computer.

## Hosting
On a server with Docker, point a domain at it, then:

```bash
echo DOMAIN=bloki.example.com > .env
docker compose up -d
```

Caddy gets the HTTPS certificate and passes the live-editing WebSockets through; Bloki keeps its data in the `bloki` volume.
Every day the server writes a copy of the database to `/data/backups/bloki-YYYY-MM-DD.db` and keeps the last 7
(`BLOKI_BACKUP_DAYS`, 0 turns it off). For an off-site copy take the newest backup and the uploads:
`docker compose cp bloki:/data/backups ./backups` and `docker compose cp bloki:/data/files ./files`.
Update with `git pull && docker compose up -d --build`.

Without Docker, behind your own HTTPS proxy: `HOST=0.0.0.0 BLOKI_SECURE_COOKIE=1 BLOKI_TRUST_PROXY=1 npm start`
(the proxy must forward WebSockets on `/collab` and `/live`, keep the `Host` header and append the client to `X-Forwarded-For`;
leave `BLOKI_TRUST_PROXY` off when nothing sits in front, or anyone could pick the address used to throttle logins).

## Email
Bloki sends email when you give it an SMTP server and the address people open it at:

```bash
BLOKI_SMTP_URL=smtps://user:password@smtp.example.com:465   # or smtp://…:587 with STARTTLS
BLOKI_MAIL_FROM="Bloki <bloki@example.com>"
BLOKI_URL=https://bloki.example.com
```

With that, inviting an email address without an account emails them the invite, notifications also arrive by email
(each person can turn that off in Settings → Notifications), and the login screen offers "Forgot password?".
Without it, invites are links you pass on and nothing is emailed.

## API
Create a token in Settings → Connections; it can do what you can in that workspace. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer bloki_…" https://bloki.example.com/api/pages
curl -H "Authorization: Bearer bloki_…" -H "content-type: application/json" -d '{"title":"From a script","section":"private"}' https://bloki.example.com/api/pages
```

The useful calls: `GET /api/pages` (the tree), `GET/PATCH/DELETE /api/pages/<id>` (one page with its blocks; PATCH takes `title`, `content`, `props`, `parent_id`…),
`POST /api/pages` (`parent_id` or `section`, `title`, `content`, `props`; a database row has the database as parent), `GET /api/search?q=…`,
`GET/POST /api/pages/<id>/comments`. Tokens can't change the account, other tokens or webhooks.

Workspace owners can add webhooks there too: Bloki POSTs `{ event, at, workspace_id, data }` for `page.created`, `page.updated`, `page.deleted`
and `comment.created`, with `X-Bloki-Signature: sha256=<HMAC-SHA256 of the body with the webhook's secret>`. A webhook only hears about pages its creator can see.

## What's in it
- **Sidebar**: workspace switcher, Search, Home, Inbox, Favorites/Workspace/Shared/Private sections, page "⋯" menus
  (favorite, copy link, duplicate, rename, move, trash, open in new tab), drag to nest, resizable and collapsible, Settings, Templates, Trash.
- **Pages**: icons (emoji, icons, uploads), covers with reposition, Style (Default/Serif/Mono), Small text, Full width, Lock,
  Customize page, Version history, Export (Markdown, HTML, PDF), Import, backlinks, word count.
- **Editor**: Notion's `/` menu, `@` people/pages/dates, `[[` page links, block ⋮⋮ menu (Turn into, Color, Copy link to block,
  Duplicate, Move to, Delete, Comment), formatting toolbar with comments, toggles and toggle headings, callouts, code,
  tables, columns, sub-pages, table of contents, breadcrumbs, embeds, bookmarks, equations, media, buttons (insert blocks, add a page to a database, edit pages in a database, send a notification, confirm, open a page or link).
- **Comments**: page discussions, comments on selected text, replies, resolve, edit, delete, comment sidebar, Updates sidebar.
- **Databases**: table, board, gallery, list, calendar, timeline, chart (vertical or horizontal bars, line, donut; count, sum or average by any groupable property), feed (pages as posts with their content), dashboard (other views side by side) and form views (forms add rows; share them with members or anyone with the link); filters, sorts, grouping, hidden groups, calculations,
  column resize, row drag, bulk actions, side and center peek, sub-items (rows nested under a parent item) and dependencies (Blocked by / Blocking, drawn as arrows on the timeline); properties incl. status, person, files, relation (two-way),
  rollup, formula (Notion 2.0 style), created/edited time and by, and unique IDs.
- **People**: workspaces, teamspaces (open, closed or private, with owners and members, in their own sidebar section), owners/members/guests, invite links, per-page access levels (Full access, Can edit, Can edit content,
  Can comment, Can view), general access, publish to web (with a site address /s/<name>, header links to its top pages, and optional search engine indexing with robots.txt and a sitemap), Inbox notifications with per-person settings.
- **Live co-editing**: several people on one page at once, with named cursors. View-only people can't change the shared doc.
- **Live sidebar and databases**: edits by others appear without reloading; only the changed page is fetched, and only by people who can see it.
- **Search**: full-text index (SQLite FTS5) over titles and page text, matching word starts and ignoring accents; titles rank first.
- **Fast with big databases**: long tables only render the rows on screen; the editor downloads separately from the app shell.
- **Settings**: My account (with 2-step verification: authenticator-app codes and one-time recovery codes), My settings (appearance, week start, start page), My notifications, workspace settings, People, Import (Notion export .zip, CSV, Markdown, HTML).

## Not like Notion
No AI, map views, web clipper, or mobile apps. Comments are plain text. Hosted Notion's icon set, fonts and branding aren't copied.

## Desktop app (macOS, Windows, Linux)
`desktop/` is an Electron app that opens your Bloki server in its own window, like Notion's desktop app:
- **Tabs** in a 36px tab bar (tabs 36–200px wide): New Tab ⌘T, Close Tab ⌘W, Close Window ⌘⇧W, Reopen Last Closed Tab ⌘⇧T,
  next/previous Ctrl+Tab / Ctrl+⇧Tab or ⌘⇧] / ⌘⇧[, ⌘1–⌘8 and ⌘9 for the last tab, drag to reorder, middle-click to close.
  Right-click a tab to Refresh, Duplicate, Pin/Unpin, Move Tab to New Window, or close it, the others, or those left/right of it.
  ⌘-click or "Open in New Tab" on a Bloki link opens a tab next to the current one.
- **Tabs come back** after a restart, window by window (File → Quit/Exit Without Saving Tabs skips that).
- **Launch picture**: until the page has drawn, the window shows a picture of how it looked when you closed it (kept separately for light and dark), or an empty sidebar and page.
- **No internet connection** shows in the tab bar while offline.
- **Command Search**: ⇧⌘K from any app opens a floating search; ↵ opens the page in Bloki, ⌘↵ in a new tab. Turn the shortcut off in the app menu.
- **Open at Login** in the app menu (installed app only).
- ⌘L copies the link to the current page, ⌘⌥L a link titled with the page name; ⌘R reloads, ⌘, opens Settings.
- Back/forward (also mouse buttons and swipes), new windows, spell check, `bloki://<page id>` links, the tab bar follows the page's light/dark theme.

Not yet as in Notion: tab groups / Tab Spaces, dragging a tab into another window.
On first launch it asks for the server address (it must be `https://`, except `localhost` on the same computer);
change it later from the workspace menu or the app menu. Nothing of the server runs inside the app.

```bash
cd desktop
npm install
npm start                 # run it
npm run dist:mac          # .dmg and .zip for Apple silicon and Intel
npm run dist:win          # Windows installer (.exe, x64 and ARM)
npm run dist:linux        # .AppImage and .deb (x64 and ARM)
```

Installers end up in `desktop/dist/`. They aren't code-signed: on macOS right-click the app and choose Open the first time;
on Windows choose "More info → Run anyway" in SmartScreen.
