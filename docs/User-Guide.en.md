> 🌐 **繁體中文** · [繁體中文版本](./使用手冊_User-Guide.md)

# Cinderous User Guide

> For anyone using decentralized instant messaging for the first time. This guide focuses on the ways Cinderous is **different** from apps like LINE / Messenger — these differences aren't there to make life hard; they're the price of "no single company controlling your account and messages," and in return you get a system where **no one can peek at, block, or delete your conversations**.

---

## 0. Understand one thing first: there are no "accounts" here

LINE has a central server that remembers "this phone number = this account," and your messages, friends, and profile picture all live on their side. That's why, when you switch phones or forget your password, you can reclaim your account with an "SMS verification" — because LINE can prove "you are you" at any time.

**Cinderous has no such server.** Your identity is not a username-and-password pair; it's a **key that only you hold** (technically called a "private key," which looks like `nsec1...`). This key:

- **Is generated on your device and never uploaded to anyone** — so no company, government, or hacker can steal it from a server.
- **Is your identity itself** — whoever holds it is you. Conversely, if you lose it without a backup, there's no "account recovery" support line that can save you.

Once this idea clicks, everything that follows — "why back up," "why switching phones takes care" — falls into place.

| | LINE | Cinderous |
| --- | --- | --- |
| Your identity is | An account tied to a phone number | A key unique to you (private key nsec) |
| Who keeps your data | LINE's servers | **Only your device** (messages don't go to the cloud unless you turn it on) |
| Switching phones relies on | SMS verification | Backup code / cloud backup / device pairing (§5 of this guide) |
| Forgetting your password relies on | Password-reset email | Your private key backup (§4 of this guide) |

---

## 1. First time: the login screen

Open Cinderous and you'll see two fields:

- **Display name**: the name others see. **It's just a label**, not an account — it can be a duplicate of someone else's, and you can change it anytime. It **cannot** be used to log in or recover your identity (what finds you is the key below, not the name).
- **Relay URL**: usually **a working relay is already filled in for you**, so you can just log in without typing anything. Change it if you want a different one; clear it to enter demo mode (play locally, without connecting to the real network).

> **What is a "relay"?** It's a mailbox that "hands off messages" between you and your contacts — when the other person is offline, your message (**already encrypted**) is held here temporarily until they come online to pick it up (stored for up to 7 days). The relay **only sees ciphertext**; it can't see the content, nor who you're chatting with. You can use the official one, one a friend self-hosts, or run your own (see `docs/self-hosting-raspberry-pi.md`).

After you press "Log in," Cinderous **generates a brand-new key on your device** — this becomes your new identity. The first time really is that simple; the complicated parts are all about "how to protect and move this key later on."

> ⚠️ **Important**: this step generates a **brand-new identity**. If your goal is to "log in to your old identity" on a new phone, **do not** log in again from this screen (that would create a new person completely unrelated to the old one) — see §5, "Switching devices."

---

## 2. Adding contacts: with keys, not a phone book

LINE adds friends via phone numbers or by scanning a LINE ID. Cinderous has no phone book, so adding a contact relies on **the other person's public key** (called `npub1...`, the "public version" corresponding to the private key — perfectly safe to share).

Three ways:

1. **Paste their share string**: the other person copies "My ID" in their own app and sends it to you, and you paste it in. The string might look like `npub1...` or `npub1...@wss://their-relay` (that last part tells your app "which relay to find them at").
2. **Scan a QR code**: they show a QR and you scan it (mobile).
3. Once added, the first time the two of you communicate you'll **automatically exchange display names**, so you don't have to type in the other person's name manually.

> Why exchange "relay location"? Because everyone might use a different relay. Your app automatically remembers "this contact is on that relay," so messages go straight to the right place afterward; and even if it's remembered wrong, the system has a fallback that routes around to deliver anyway. All of this is automatic — you usually don't need to worry about it.

---

## 3. Everyday use: just like what you're used to

Sending messages, stickers, emoji, read receipts, groups, voice and video calls, sending files — these work no differently from any regular messaging app, so just use them. The only difference is "behind the scenes":

- Every message and every call is **end-to-end encrypted**. The relay and any third party see nothing but gibberish.
- Messages are **stored on your own device first**. That's great for privacy, but it also means "your data won't automatically appear on a new phone when you switch devices" — which is exactly what §5 is here to solve.

---

## 4. Local password: extra protection on a shared computer (optional)

**If you're the only one who uses this device, you can skip this section.** The local password is for the "multiple people sharing one computer" scenario.

### What it protects

Without a local password, anyone who can open your computer and get into your Windows account can walk straight into your Cinderous and read your messages. Once it's set, your private key and local data are **encrypted** by the password — without the password, even carrying off the whole computer won't crack it.

### How to set it

**Settings → "Security (Local Password)" → "Enable local password."** During the process it will **ask you to back up your private key first** (see below) and to enter a new password twice. Once enabled, an unlock screen appears every time you open the app.

There are also two advanced options:
- **Hide this identity**: after enabling the password you can check this to keep this identity **from even appearing in the switch list** — on a shared computer, others won't even know "you have this identity." Bring it back later with the 🔒 button in the identity bar and entering your password.
- **Auto-lock when idle**: if you leave the computer with no activity for 5 minutes, it locks itself back up.

### ⚠️ What if you forget the local password?

This is the point that most needs understanding. The password **isn't checked against a stored copy**; it's "raw material for the key that unlocks your data" — so the system **doesn't store your password at all**, and **can't "reset" it or "send a reset email."** That sounds scary, but there is a rescue path:

**When you forget the password, tap "Forgot password?" on the unlock screen, enter your private key (nsec) or encrypted backup code, and set a brand-new password** — this recovers the **complete data** on this device (not a fresh start; it opens exactly as it was).

In other words: **your private key backup is your "forgot password" insurance.** This is also why it makes you back up before enabling the password.

> But if you've **lost even your private key backup and forgotten the password** — then the local data on this device really is permanently unopenable (there's no back door). So: **keep your private key backup safe.**

---

## 5. Switching devices / phones: three routes, depending on how much you want to recover

This is where Cinderous differs from LINE the most, and where advance preparation matters most. LINE handles a device switch with one tap because your data is all on their servers. Cinderous's data is **in your own hands**, so you have to pick a way to move it over.

**First, remember one key term: private key (nsec) = your master key.** It can restore your identity on any new device. The three routes below differ in "how much data, beyond your identity, can be moved back with it."

### Route A: Encrypted backup code (recommended as insurance)

**What it is**: your private key encrypted with a **backup password you set yourself**, packaged into a string plus a QR. You keep it yourself (print it, store it on a USB drive, or in a cloud you trust — all fine).

**How to generate it**: Settings → "Identity backup" → "Generate encrypted backup code" → set a backup password.

**How to restore it**: on the new device's "Add identity," paste the backup code and enter the backup password.

**What it recovers**: the identity itself plus your relay location. **Contacts and messages don't come back via this route** (that takes B or C) — but your identity is alive, so friends' messages will gradually reappear as they message you.

> This is the "last line of defense," and it's strongly recommended everyone makes one. It's safer than copying the private key directly (an extra layer of password), and losing it just voids that one copy without affecting your identity.

### Route B: Encrypted cloud backup (the most LINE-like device-switch experience, but off by default)

**What it is**: a copy of your **encrypted** state (contacts, groups, block list, settings, and even recent messages) stored on your relay. After logging in on a new device it's **pulled down automatically and restored in seconds**. Throughout, the relay only ever sees ciphertext.

**How to turn it on**: Settings → "Cloud backup (encrypted)" → pick a mode:
- **Off** (default): nothing is uploaded, maximum privacy.
- **Basic**: contacts, groups, block list, settings (no message content).
- **Full**: Basic plus recent messages.

**How to restore it**: after logging in on the new device with "backup code + password," the snapshot is merged in automatically.

**Trade-off**: this is the closest thing to LINE's "automatic restore on a new device," at the cost of your encrypted state being **stored on the relay** (as ciphertext, though). That's why it's **off by default** and left for you to decide whether to enable. Turning it off **immediately deletes** that backup on the relay.

> An honest reminder: the backup is protected by your **identity private key**, not the local password. Anyone who obtains your private key could already read your messages, so this doesn't open an extra hole — but if you don't want even "recent messages" left on the relay, choose "Basic" or "Off."

### Route C: Device pairing (the most complete and private, when both devices are on hand)

**What it is**: the old and new devices **connect directly** (peer-to-peer, without going through the relay at all) to move **all data** — including full message history — across.

**How to do it**:
1. Old device: Settings → "Pair a new device" → a pairing code and QR appear.
2. New device: login screen → "Import from an old device" → paste the pairing code.
3. Each device displays a set of **4 digits**. **Confirm the digits match on both sides**, then press "Match, start transfer" on the old device.
4. Once done, the new device is a complete copy of the old one.

> Those 4 digits (called SAS) guard against "someone intercepting the pairing code midway to impersonate your new device." **If the digits don't match, something is definitely wrong — press "No match" to abort.** This step costs you three seconds but blocks the most dangerous attack.

**Trade-off**: it moves the most complete data and the content never touches the relay (most private), but it **requires both devices to be on hand and powered on at the same time**. It's suited to "the old phone is still around and you're switching to a new one."

### How to choose among the three routes

| Scenario | Recommendation |
| --- | --- |
| The insurance you should have anyway | **A backup code** (make one and keep it safe) |
| Old device still around, moving to a new one | **C pairing** (most complete) |
| Old device already lost/damaged, but you'd turned on cloud backup before | **B backup** (automatic restore) |
| Old device already lost, no cloud backup, only a backup code | **A**: identity comes back, friends gradually reappear as they message you, and the last 7 days of messages are filled back in from the relay |

> **Lost everything, with no backup at all?** Then the identity can't be restored (no support line can save you, because there's simply no server holding your key). This is exactly why you should **go make a backup code right now**.

---

## 6. Switching relays

To switch to a different relay (for example, the one you were using shut down, or you want to move to one a friend self-hosts), **you don't need to change your identity.**

**Settings → the relay section → "Switch relay" →** enter the new URL. The app will:
- Keep your identity, contacts, and entire history (only the "mailbox" changes).
- Automatically notify your friends "I've moved to a new relay," and they'll send messages to the new one afterward.
- **No-missed-message guarantee**: for 7 days after switching relays, the app **automatically** keeps picking up from the old relay "messages sent by friends who haven't rerouted yet," ensuring nothing is missed. This is fully automatic — you don't need to do anything (and nothing is shown for it).

> This is completely different from "logging in again." Logging in again = becoming a new person; switching relays = the same you, a different mailbox. The system is designed so the former never happens by accident.

---

## 7. One device, multiple identities

You can have multiple identities in the same app (for example "work" and "personal"), switching between them with the **identity switcher bar** at the top of the screen. Each identity's data is fully isolated and can't see the others, and outsiders **can't tell that the two identities are the same person** (this is deliberate privacy protection).

- Use the **+** in the identity bar to add an identity (generate a brand-new one, or import an existing one by pasting a private key / backup code).
- Combined with §4's "Hide identity," some identities can be hidden away entirely.

---

## 8. Frequently asked questions (FAQ)

**Q: I just want to chat — why do I need to understand so much?**
A: For everyday chatting you don't need to understand anything; use it just like LINE. The complicated parts of this guide are all for "switching devices" and "protecting your key" — and doing one thing sets your mind at ease: **go to Settings, generate an encrypted backup code, and keep it safe** (§5 Route A).

**Q: A friend suddenly disappeared from my list?**
A: Usually it's temporary. The friend list is rebuilt from "receiving messages from them," so they'll come back as soon as they message you or broadcast when they come online. One-way friends (you added them, they didn't add you) may need you to paste their npub again.

**Q: Forgot the local password?**
A: On the unlock screen tap "Forgot password?", recover with your private key or backup code, and set a new password (§4). This assumes you have a backup.

**Q: Switching phones but the old phone is already broken/lost?**
A: It depends on what backup you made before — with a cloud backup it restores automatically (§5-B); with only a backup code you restore the identity, and data reappears via friends plus the 7-day catch-up (§5-A). **With neither, it can't be restored**, so please be sure to back up in advance.

**Q: Can my messages really not be seen by anyone?**
A: Correct. End-to-end encrypted; the relay and any third party see only ciphertext. The only ones who can read them are you and the person you're talking to. The cost is that "no server keeps them for you," so backups are up to you.

**Q: Groups disappeared after switching phones?**
A: Groups are a bit special. If you're the **group owner**, the groups are in your data and move with you. If you're a **member**, the group automatically adds you back the **next time the group owner comes online** (the owner's app periodically broadcasts the group roster); and group messages missed within 7 days are also filled back in once the group is restored.

**Q: Enterprise/internal company use?**
A: Cinderous has an enterprise mode — the company self-hosts a closed relay, an administrator distributes the member roster, and certain policies can be enforced (for example, disabling file transfer, or routing calls through the company server). This part is configured by the company administrator; ordinary members just use it as usual.

---

## 9. Glossary

| Cinderous term | Plain language / LINE analogy |
| --- | --- |
| Private key (nsec1…) | Your master key = your identity itself. **Top secret, equal to everything you have.** |
| Public key / npub (npub1…) | Your "ID," given to others so they can add you; fine to make public. |
| Relay | A mailbox that helps hand off encrypted messages (swappable, self-hostable). |
| Display name | Just a label; not an account, can be a duplicate, can be changed. |
| Local password | The lock on this device (only needed on a shared computer). |
| Encrypted backup code | Your "switch device / forgot password" insurance, kept by you. |
| Cloud backup | Encrypted state stored on the relay, restored automatically on a new device (you turn it on yourself). |
| Device pairing | Two devices face-to-face moving all data directly. |

---

## 10. In one sentence

**Cinderous takes "your data is controlled by you" all the way — at the cost of "switching devices and backups being your own responsibility."**
Newcomers only need to remember one thing: **go into Settings right now, generate an encrypted backup code, and keep it somewhere safe.** Everything else is no different from the messaging app you use every day.
