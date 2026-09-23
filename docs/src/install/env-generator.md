---
pageClass: env-generator-page
aside: false
---

# Interactive .env Generator

Use this interactive questionnaire to quickly generate a clean, secure `.env` file tailored for your deployment.

<EnvGenerator />

---

## What to do with the generated `.env` file?

1. Place the generated `.env` file in the same directory as your `docker-compose.yml`.
2. Run:
   ```bash
   docker compose pull && docker compose up -d
   ```
3. Open your browser to the URL you configured above (e.g. `http://localhost:3004`).
4. **Register your account**. Unless you set `SPARKY_FITNESS_DISABLE_SIGNUP=true`, the very first user to sign up is granted full **Administrator** privileges. If you set `SPARKY_FITNESS_ADMIN_EMAIL`, register with that address — the server promotes the matching account on every startup.
5. Configure the rest from the right place for each feature:
   - **AI providers** and **OpenFoodFacts** — **Admin > System Settings** in the web interface.
   - **Garmin** — each user connects their own account under their integration settings.
   - **SMTP** — environment variables only; use the SMTP module in the generator above.
