# Supabase Guest Mode

True guest mode for `/start/guest` depends on Supabase anonymous auth being enabled.

## Enable anonymous sign-ins

1. Open your Supabase project dashboard.
2. Go to **Authentication**.
3. Open **Providers**.
4. Select **Anonymous Sign-Ins**.
5. Turn **Enable anonymous sign-ins** on and save.

## Operational note

- If anonymous sign-ins are enabled, `/start/guest` keeps the full guest reflection flow.
- If anonymous sign-ins are disabled, the app now falls back to the signup/free-trial path without crashing.
- Attribution parameters are still preserved in the fallback, but true guest mode requires the anonymous sign-in toggle above.
