# Hawk Hill PR Window

A zero-backend static web app that ranks the next seven days of 15-minute Hawk Hill forecast windows for a PR attempt.

## What it does

- Loads Open-Meteo 15-minute wind, gust, temperature, precipitation, daylight data.
- Uses the public Strava Hawk Hill segment polyline (segment 229781).
- Projects wind onto each route leg, rather than using one average bearing.
- Solves a simple cycling physics model (gravity + rolling resistance + yaw-aware relative-air drag) for predicted time.
- Ranks daylight, dry, non-extreme-gust windows.
- Lets the rider adjust power, body mass, bike/kit mass, and CdA. Settings persist in browser localStorage.

## Deploy

The folder is static and needs no build command. On Vercel, deploy this folder as a static project.
