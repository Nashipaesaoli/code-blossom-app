# Code Blossom 🌸

Nashipae's personal coding journal: a welcome page, a list of languages you're
learning, a place to write dated docs about your progress, a toolbox for code
snippets and links, and a daily coding streak — all pink, and all saved in a
real database so it works from any device.

This version is a small full-stack app:

- **Frontend:** one HTML file (`public/index.html`) — no build step.
- **Backend:** a Node.js + Express server (`server.js`) with one password-protected login.
- **Database:** PostgreSQL, using the schema in `schema.sql`.

Everything you save goes through the server to the database. Nothing is
stored only in the browser anymore, so your data will be the same whether you
open the site on your laptop or your phone.

---

## 1. What you'll need

- **Node.js** version 18 or newer. Check with `node -v`. If you don't have
  it, install it from [nodejs.org](https://nodejs.org/).
- **A PostgreSQL database.** You have two easy options:
  - **Local:** install Postgres on your own machine (good for testing).
  - **Hosted (recommended for beginners):** a free database from
    [Neon](https://neon.tech) or [Supabase](https://supabase.com). You don't
    install anything — you just copy a connection string. This is the
    easiest path if this is your first time working with a database.
- A code editor (VS Code is a good free choice) and a terminal.

---

## 2. Get a database connection string

If you're using a hosted database (Neon or Supabase), sign up, create a new
project, and look for a **connection string**. It looks like this:

```
postgres://username:password@host.example.com/dbname?sslmode=require
```

Copy that whole string — you'll paste it into `.env` in the next step.

If you'd rather run Postgres locally, install it, then create a database and
user:

```bash
createuser blossom --pwprompt
createdb blossom --owner=blossom
```

Your local connection string will then be:

```
postgres://blossom:yourpassword@localhost:5432/blossom
```

---

## 3. Set up the project on your computer

```bash
# Move into the project folder
cd code-blossom

# Install the server's dependencies
npm install

# Copy the example settings file
cp env.example .env
```

Now open `.env` in your editor and fill in three things:

```ini
DATABASE_URL=postgres://...        # the connection string from step 2
APP_PASSWORD=pick-something-only-you-know
SESSION_SECRET=a-long-random-string
```

To generate a good `SESSION_SECRET`, run:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

and paste the result in. `.env` is already listed in `.gitignore`, so it
will never be uploaded to GitHub by accident — keep it that way, since it
holds your password and secret.

---

## 4. Run it

```bash
npm start
```

You should see:

```
Code Blossom is running on http://localhost:3000
```

The first time it runs, the server automatically creates all the database
tables it needs (from `schema.sql`) — you don't need to run any SQL by hand.

Open **http://localhost:3000** in your browser. You'll see a sign-in screen —
type the `APP_PASSWORD` you set in `.env`. After that you're in, and
everything you do (adding a language, writing a doc, saving a snippet,
checking in for the day) is saved straight to your database.

---

## 5. How your data is stored

| What you see in the app | Where it lives |
|---|---|
| Languages you're learning | `languages` table |
| Docs and their tags | `docs` table |
| Saved code snippets | `snippets` table |
| Saved links | `links` table |
| Roadmap steps you've ticked | `steps` table |
| Days you've checked in (for your streak) | `days` table |
| Light/dark mode | `settings` table |

The app saves automatically a moment after you stop typing — you'll see a
small **Saved** indicator at the bottom of the page. If your internet drops,
it says **Not saved** and keeps a local copy in your browser until it can
reach the server again, so you won't lose anything you just wrote.

There's still a **Download a backup** link at the bottom of the page. It
exports everything as a `.json` file — a good habit before big changes, or
just for peace of mind.

---

## 6. Making sure your links actually work

When you save a link in the Toolbox, there's a **Check this link works**
button. Here's what it does, and why it's built the way it is:

1. You type an address (you can leave off `https://` — it will add it).
2. The **server** — not your browser — visits that address for you. It
   follows any redirects, and if the page loads, it reads the page's title
   and fills that in for you automatically.
3. You'll see one of:
   - ✅ *"This link works — 'Page Title Here'."*
   - An explanation if it doesn't: the address doesn't exist, the site
     didn't respond in time, or it returned an error page.

This check happens on the server for a good reason: some sites block
requests made directly from a browser (CORS), so checking from the browser
alone would report a false failure. The server also refuses to check private
or internal addresses (like `localhost` or `192.168.x.x`), so this feature
can't be used to probe your own network — only real public websites.

Saving a link doesn't require passing the check — you can save a link
you haven't checked yet — but running the check first means you'll know
right away if you mistyped something.

---

## 7. Deploying it so you can use it anywhere

Once it works on your computer, put it online. This guide uses
[Render](https://render.com) because it has a free tier and a simple
dashboard, but the same steps work on Railway, Fly.io, or any host that runs
Node.js apps.

### Step 1 — Push your project to GitHub

```bash
git init
git add .
git commit -m "Code Blossom"
```

Create a new repository on [GitHub](https://github.com/new), then follow the
instructions it gives you to push your local project there. (Because `.env`
is in `.gitignore`, your password and secret will **not** be uploaded — you
set them again directly on your host, in the next step.)

### Step 2 — Create the web service

1. Go to [render.com](https://render.com) and sign up.
2. Click **New +** → **Web Service**, and connect your GitHub repository.
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Under **Environment**, add the same three variables from your `.env`
   file: `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`. Also add:
   ```
   NODE_ENV=production
   ```
   This makes your login cookie HTTPS-only, which matters once you're
   live on the internet.
5. If you don't already have a hosted database, Render, Neon, and Supabase
   can all create a free Postgres database for you — grab its connection
   string and use that for `DATABASE_URL`.
6. Click **Create Web Service**. Render will install everything and start
   your app; the first deploy takes a few minutes.

When it's done, Render gives you a web address like
`https://code-blossom.onrender.com`. Open it, sign in with your password, and
everything you saved locally in testing will *not* be there (this is a new,
empty database) — you're starting fresh on your live site. From here on,
anything you save goes to this database, and you can open the same address
from your phone or any computer and see the same data.

### Updating your live site later

Whenever you want to change something, edit the files, then:

```bash
git add .
git commit -m "describe what you changed"
git push
```

Render (and most hosts) will notice the push and redeploy automatically.

---

## 8. Project files

```
code-blossom/
├── server.js         The Express server: login, API, link checker
├── schema.sql         Database tables (created automatically on first run)
├── package.json        Project info and dependencies
├── env.example          Template for your settings — copy to .env
├── public/
│   └── index.html      The whole frontend (HTML, CSS and JavaScript in one file)
└── README.md           This file
```

---

## 9. Troubleshooting

**"Could not set up the database. Check DATABASE_URL."**
Your connection string is missing, mistyped, or the database isn't reachable
from where you're running the app. Double check you copied the whole string,
including the password.

**The site loads but I can't sign in.**
Make sure `APP_PASSWORD` in your `.env` (or your host's environment
variables) matches exactly what you're typing — it's case-sensitive.

**"Too many tries. Wait a few minutes."**
After 8 wrong password attempts in 10 minutes, the server briefly blocks
further tries from your address. This protects your password from being
guessed. Just wait a bit and try again.

**A saved link's "Check" button says it can't reach the address.**
Some sites block automated visits, or the site may be slow. The link can
still be saved and opened normally in a browser — the check is just a
courtesy, not a requirement.

**I want to start over with a clean database.**
Connect to your database (with `psql`, or your host's dashboard) and run:
```sql
DROP TABLE languages, docs, snippets, links, steps, days, settings;
```
Then restart the server — it will recreate empty tables automatically.

---

Good luck with the rest of your coding journey, Nashipae. 🌸
