---
title: Connect to a server
description: Connect the Aldus app to a household server.
---

You need an address and credentials supplied by the person who runs your Aldus server. Aldus is not a hosted service — every browser or app session connects to a specific household server.

## Connect in a browser

Open the exact server address the owner gave you — for example `https://library.example.com` or a local address like `http://192.168.1.20:8080`. The web app belongs to that server, so there is no separate server picker in the browser. Sign in with the one-time username and password you received, then choose your final credentials.

## Connect in the iOS or Android app

1. Open **Connect to Aldus**. If you have connected before, your saved servers appear here so you can switch between them.
2. Enter the server address in **Server address** and select **Continue**.
3. Aldus verifies the address, then opens sign-in, first-time setup, or the public demo as appropriate.
4. Sign in with the one-time username and password your server owner gave you. Aldus then asks you to choose your final credentials before opening the library.

## HTTP versus HTTPS

Aldus accepts plain `http://` addresses for servers on your private network — this is how most home installs run, reached over your own Wi-Fi rather than the public internet. For any server reached over the internet, use `https://`; the app enforces secure networking by default and only allows local, unencrypted addresses so a household server without a certificate still works from inside the house.

## If the address is wrong

If the address doesn't point at an Aldus server at all — a typo, a site that returns something other than JSON — you'll see **That address is not an Aldus server.** If Aldus can't reach the address at all (server offline, wrong network, expired certificate), you'll see **Unable to connect. Check the address, network, and HTTPS certificate.** Either way, nothing is saved until a server actually responds correctly.

## If your credentials are wrong

A wrong username or password at sign-in is rejected outright — Aldus does not say which one is incorrect, to avoid confirming valid usernames to someone guessing. Repeated failed attempts are rate-limited, so a wrong password won't lock you out, but it will start refusing attempts for a short window if you retry too quickly.
