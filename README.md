# 🛡️ Procurement Approval System - Master Dashboard

A premium, glassmorphic management dashboard for tracking and dispatching professional procurement approvals.

---

### ✅ SECURITY STATUS: 100% SECURE FOR PUBLIC GITHUB
This repository is completely clean and **DOES NOT** contain any API keys, passwords, or database URLs in the source code.
You can safely host this on GitHub Pages as a **Public** repository!

---

## 🚀 Overview
This dashboard allows procurement managers to:
- Enter and manage **PO Approvals** and **Advance Approvals**.
- View automated SAR/Currency conversion rates.
- Dispatch professional, formatted email reports to the GM via **EmailJS**.
- Collaborate in real-time using the **Supabase** backend.

## 🗝️ Initial Team Setup (First-Run)
Because the codebase is completely public-safe, **new team members** must securely connect their browser to the company database and email server the first time they open the dashboard.

### 1. Database Connection
When you first open `index.html`, a **Setup Modal** will appear. 
You must paste the following two secrets into the modal to activate the dashboard:
1. **Supabase Project URL** (e.g. `https://abcdefghijklmnopqr.supabase.co`)
2. **Team Database Key** (The long `anon public` key)

*Note: These keys are cached locally in your browser's secure memory (`localStorage`) and are never uploaded to the internet.*

### 2. Email Server Configuration
To allow the dashboard to dispatch reports to the GM, you must configure the Email Server:
1. Click the ⚙️ **Settings (gear)** icon in the top right.
2. Scroll to **EmailJS Configuration**.
3. Enter the **Service ID**, **Template ID**, and **Public Key**.
4. Click **Save Settings**.

## 🛠️ Project Structure
- `index.html`: Modern, responsive dashboard (Day/Dark mode supported).
- `style.css`: Premium Glassmorphism design system.
- `script.js`: Core logic for UI, Supabase sync, and EmailJS dispatching.
- `.gitignore`: Prevents temporary OS files from uploading to GitHub.

## 🌓 Themes
The dashboard supports a **Professional Day Mode** and a **Sleek Dark Mode**. Toggle the theme using the moon/sun button in the header. Your preference will automatically be saved.

---
*Created meticulously for the Olayan Procurement Team.*
