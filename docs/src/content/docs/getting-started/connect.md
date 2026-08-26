---
title: Connect to a server
description: Connect the Aldus app to a household server.
---

You need an address and credentials supplied by the person who runs your Aldus server. Aldus is not a hosted service — the app is only a window onto whichever server you point it at, and it remembers every server you've connected to so switching later is quick.

## Connect

1. Open Aldus. On a phone or tablet, this is the **Connect to Aldus** screen; if you've connected before, your previous servers are listed here too so you can jump straight back to one.
2. Enter the server address in the **Server address** field — for example `demo.aldus.media` or a local address like `http://192.168.1.20:8080`.
3. Select **Continue**.
4. Aldus checks the address, then sends you to the right place: sign-in if the server already has accounts, first-time setup if it's brand new, or the demo welcome screen if the server offers a public demo.
5. Sign in with the username and password your server owner gave you.

## HTTP versus HTTPS

Aldus accepts plain `http://` addresses for servers on your private network — this is how most home installs run, reached over your own Wi-Fi rather than the public internet. For any server reached over the internet, use `https://`; the app enforces secure networking by default and only allows local, unencrypted addresses so a household server without a certificate still works from inside the house.

## If the address is wrong

If the address doesn't point at an Aldus server at all — a typo, a site that returns something other than JSON — you'll see **That address is not an Aldus server.** If Aldus can't reach the address at all (server offline, wrong network, expired certificate), you'll see **Unable to connect. Check the address, network, and HTTPS certificate.** Either way, nothing is saved until a server actually responds correctly.

## If your credentials are wrong

A wrong username or password at sign-in is rejected outright — Aldus does not say which one is incorrect, to avoid confirming valid usernames to someone guessing. Repeated failed attempts are rate-limited, so a wrong password won't lock you out, but it will start refusing attempts for a short window if you retry too quickly.
