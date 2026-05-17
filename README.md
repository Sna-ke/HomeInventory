# Box Inventory Tracker — Home Assistant App

Track packed items in boxes across rooms, with QR code label printing. Backed by the MariaDB Home Assistant app.

---

## Repository Structure

This repo is structured so Home Assistant can find it as a custom repository:

```
repo-root/
├── repository.json              ← Required by HA to validate the repo
└── box-inventory-tracker/       ← The app lives in this subfolder
    ├── config.yaml
    ├── Dockerfile
    ├── run.sh
    ├── build.json
    └── app/
        ├── server.py
        ├── requirements.txt
        └── templates/
            └── index.html
```

> ⚠️ **Before pushing to GitHub**, edit `repository.json` and replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repo name.

---

## Prerequisites

1. **MariaDB app** installed and running in Home Assistant.
2. A database and user created for this app (see below).

---

## MariaDB Setup

Open the **Terminal & SSH** app in Home Assistant and run:

```bash
# Connect to MariaDB (password is what you set in the MariaDB app config)
mysql -u root -p

# Create the database and user
CREATE DATABASE box_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'boxtrack'@'%' IDENTIFIED BY 'your_password_here';
GRANT ALL PRIVILEGES ON box_inventory.* TO 'boxtrack'@'%';
FLUSH PRIVILEGES;
EXIT;
```

---

## Installation

### Option A — Sideload (no GitHub needed)

1. Copy the **entire repo folder** into your HA config directory so the structure looks like:
   ```
   /config/addons/box-inventory-repo/
   ├── repository.json
   └── box-inventory-tracker/
       ├── config.yaml
       └── ...
   ```
2. In Home Assistant: **Settings → Apps → App Store → ⋮ (top right) → Repositories**
3. Add the path: `/config/addons/box-inventory-repo`
4. Click **Add**, then **Close**.
5. Scroll down in the App Store — **Box Inventory Tracker** will appear under a new section. Install it.

### Option B — GitHub Custom Repository

1. Push this entire repo to GitHub (make sure `repository.json` is at the root, not inside a subfolder).
2. In Home Assistant: **Settings → Apps → App Store → ⋮ (top right) → Repositories**
3. Paste your GitHub repo URL, e.g.: `https://github.com/your-username/your-repo-name`
4. Click **Add**. HA will validate the repo — it looks for `repository.json` at the root.
5. **Box Inventory Tracker** will appear in the App Store. Install it.

> **Common "not a valid repository" causes:**
> - `repository.json` is missing or not at the repo root
> - The repo is private (HA can't read private repos without authentication)
> - You pasted the URL to a subfolder instead of the repo root

---

## Configuration

After installing, set these options in the app's **Configuration** tab:

| Option | Default | Description |
|---|---|---|
| `db_host` | `core-mariadb` | Hostname of the MariaDB app (default is correct for most installs) |
| `db_port` | `3306` | MariaDB port |
| `db_name` | `box_inventory` | Database name you created above |
| `db_user` | `homeassistant` | DB user (use `boxtrack` from the setup above) |
| `db_password` | *(empty)* | DB password |

---

## Usage

1. **Start the app.** It automatically creates the required database tables on first run.
2. Open the Web UI via the **Open Web UI** button, or navigate to `http://homeassistant.local:5000`.
3. **Rooms** — Add rooms first (e.g. "Living Room", "Garage", "Storage Unit").
4. **Items** — Add items with a name and category (e.g. "Rice Cooker" / "Kitchen").  
   Items are shared — the same item can appear in multiple boxes.
5. **Boxes** — Create boxes; they get auto-numbered sequentially (#1, #2…).  
   Assign a room and an optional label.
6. **Box Detail** — Open a box to add items, set quantities, and add notes per item.
7. **🖨 Print Label** — Generates a print-ready label with a QR code + large box number.  
   The QR code encodes a URL back to this app filtered to that box.  
   Use Ctrl+P / Cmd+P to send to your label printer.
8. **Search** — Use the top search bar to instantly find which box contains any item.

---

## Data Model

```
rooms       ← name
  └─ boxes  ← box_number (auto-increment), label, room_id
       └─ box_items ← box_id, item_id, quantity, notes
items       ← name, category  (referenced by box_items)
```

Items are normalized — one "Extension Cord" record can live in multiple boxes with independent quantities and notes per box.

---

## Adding to your HA Dashboard

Add a **Webpage card** to any dashboard:

```yaml
type: iframe
url: http://homeassistant.local:5000
aspect_ratio: 75%
```

Or use the sidebar shortcut — the app registers a panel icon automatically (📦).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Not a valid repository" | Make sure `repository.json` is at the **root** of the GitHub repo, and the repo is **public** |
| Can't connect to DB | Verify the MariaDB app is running and your credentials match |
| Port conflict | Change the host port mapping in the app's **Network** tab |
| Tables not created | Check app logs — it retries the DB connection 10 times at startup |
