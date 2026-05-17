# Box Inventory Tracker — Home Assistant Add-on

Track packed items in boxes across rooms, with QR code label printing. Backed by the MariaDB Home Assistant add-on.

---

## Prerequisites

1. **MariaDB add-on** installed and running in Home Assistant.
2. A database and user created for this app (see below).

---

## MariaDB Setup

SSH into your Home Assistant host (or open the Terminal add-on) and run:

```bash
# Connect to MariaDB
mysql -u root -p   # password is what you set in the MariaDB add-on config

# Create the database and user
CREATE DATABASE box_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'boxtrack'@'%' IDENTIFIED BY 'your_password_here';
GRANT ALL PRIVILEGES ON box_inventory.* TO 'boxtrack'@'%';
FLUSH PRIVILEGES;
EXIT;
```

---

## Installation

### Option A — Sideload (recommended for local development)

1. Copy the `ha-box-inventory/` folder into your HA config's `addons/` directory:
   ```
   /config/addons/ha-box-inventory/
   ```
2. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**
3. You should see **"Box Inventory Tracker"** appear under Local add-ons. Click it and install.

### Option B — Custom Repository

1. Host this repo on GitHub.
2. In HA: **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → add your repo URL.
3. Install from the store.

---

## Configuration

After installing, set these options in the add-on's **Configuration** tab:

| Option | Default | Description |
|---|---|---|
| `db_host` | `core-mariadb` | Hostname of the MariaDB add-on (default is correct for most installs) |
| `db_port` | `3306` | MariaDB port |
| `db_name` | `box_inventory` | Database name you created |
| `db_user` | `homeassistant` | DB user (use `boxtrack` from above) |
| `db_password` | *(empty)* | DB password |

---

## Usage

1. Start the add-on. It will automatically create the required tables on first run.
2. Open the Web UI (port 5000, or via the **Open Web UI** button in HA).
3. **Rooms** — Add rooms first (e.g. "Living Room", "Garage", "Storage Unit").
4. **Items** — Add items with name and category (e.g. "Rice Cooker / Kitchen").  
   Items can exist independently and be placed in multiple boxes.
5. **Boxes** — Create boxes; they get auto-numbered sequentially (Box #1, #2…).  
   Assign a room and optional label.
6. **Box Detail** — Open a box to add items, set quantities, and add notes.
7. **🖨 Print Label** — Click on any box to generate a QR code label.  
   The QR code links to the app pre-filtered to that box.  
   Use your browser's print function (Ctrl+P / Cmd+P) to send to your label printer.
8. **Search** — Use the top search bar to find which box an item is in.

---

## Data Model

```
rooms       ← name
  └─ boxes  ← box_number (auto), label, room_id
       └─ box_items ← box_id, item_id, quantity, notes
items       ← name, category  (shared across boxes)
```

Items are shared — the same "Rice Cooker" item can appear in multiple boxes with different quantities.

---

## Accessing from the HA Dashboard

Add a **Webpage card** to your dashboard:

```yaml
type: iframe
url: http://homeassistant.local:5000
aspect_ratio: 75%
```

Or use the built-in panel (the add-on registers one automatically at the sidebar icon).

---

## Troubleshooting

- **Can't connect to DB**: Check that the MariaDB add-on is running and the credentials match.
- **Port conflict**: Change the host port in the add-on's **Network** tab.
- **Tables not created**: Check add-on logs; the app retries the DB connection 10 times on startup.
