# Git & Deployment Commands Reference

Use these commands to push updates to GitHub and deploy them to your xCloud server.

## 💻 Local Machine (PowerShell / Git Bash)

Run these commands inside the `LovenseSimGame/Connect4` directory whenever you make changes and want to upload them:

```bash
# 1. Stage the modified files
git add .

# 2. Commit the changes
git commit -m "Update Connect 4 files"

# 3. Push to GitHub
git push origin main
```

---

## 🌐 Production Server (SSH Terminal)

Once pushed to GitHub, log into your server, navigate to the public directory, and run the following to pull the updates and restart the game:

```bash
# 1. Navigate to the project root directory
cd /var/www/connect4.alekzane.co.uk

# 2. Cleanly fetch and force-overwrite files to match GitHub exactly
git fetch origin
git reset --hard origin/main

# 3. Restart the game server using PM2 (usually named 'connect4' or 'app')
pm2 restart connect4
# or
pm2 restart app
```

*(Note: If you ever forget the PM2 process name, run `pm2 list` to check.)*
