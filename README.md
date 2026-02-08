# 🚗 Tire Service Bot

<div align="center">

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)

**A comprehensive Telegram Bot for managing Tire Service workflows.**  
*Developed for a service station in Dnipro, Ukraine 🇺🇦*

</div>

---

## 📖 Overview

This bot is designed to automate and streamline the operations of a tire service station. It includes a robust order management system, role-based access control for employees (Admins, Masters), and customer-facing features like warranty verification via QR codes.

It efficiently handles the entire lifecycle of a service order, from creation to completion, generating PDF warranty certificates, and tracking performance statistics.

## ✨ Key Features

- **Order Management**: Create, track, and update service orders in real-time.
- **Role-Based Access Control (RBAC)**:
  - **ADMIN**: Full system control, analytics, and order management.
  - **MASTER**: Manage assigned orders and view personal stats.
  - **USER (Customer)**: Verify warranties and check current order status.
- **Warranty Verification**: Generate unique QR codes for orders. Customers can scan to verify warranty validity instantly.
- **PDF Generation**: Automatic generation of warranty certificates (PDF) with sending via Email/Telegram.
- **Google Sheets Integration**: Sync staff data and backup order history automatically.
- **Search & Reporting**: Advanced search by phone number and detailed statistics summaries.

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (Node.js)
- **Language**: TypeScript
- **Database**: PostgreSQL with [Prisma ORM](https://www.prisma.io/)
- **Bot API**: `telegraf`
- **PDF Generation**: `pdf-lib`
- **Integrations**: Google Sheets API (`google-spreadsheet`), Nodemailer
- **Containerization**: Docker & Docker Compose

## 🚀 Getting Started

### Prerequisites

- Node.js (v20+)
- Docker & Docker Compose
- PostgreSQL (if running locally without Docker)
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Service Account Credentials (for Sheets integration)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/horoshi10v/tire-service-bot
   cd tire-service-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   
   Copy the example configuration file and update it with your credentials:
   ```bash
   cp .env.example .env
   ```
   *Make sure to fill in your Telegram Bot Token, Database URL, and Google Credentials.*

### Running the Application

#### Development Mode
```bash
# Start the database (if using Docker for DB only)
docker-compose up db -d

# Run migrations
npx prisma migrate dev

# Start the app
npm run start:dev
```

#### Production Mode (Docker)
```bash
docker-compose up -d --build
```
The application will start, and the bot will be ready to accept commands.

## 📱 Bot Commands

### For Staff (Admin/Master)

**Menu Buttons:**

| Button | Description |
|--------|-------------|
| `🆕 Новий` | Create a new order (starts by uploading a photo) |
| `🔍 Пошук` | Interactive search by phone number |
| `📌 Відкрити замовлення` | Open an order by ID |
| `📊 Зведення` | Show current order statistics |
| `🟡 Прийняті` | List orders with status **Accepted** |
| `🔵 В роботі` | List orders with status **In Progress** |
| `🟢 Готові` | List orders with status **Ready** |
| `⚫ Видані` | List orders with status **Done** |

**Text Commands:**

| Command | Description | Access |
|---------|-------------|--------|
| `/start` | Open the main menu | All |
| `/active <id>` | Open a specific order by ID | Master, Admin |
| `/search` | Search for an order by phone number | Master, Admin |
| `/edit <id>` | Edit an existing order | Master, Admin |
| `/delete <id> CONFIRM` | Delete an order permanently | **Admin only** |
| `/backup` | Backup all orders to Google Sheets | **Admin only** |
| `/sync_staff` | Sync staff list from Google Sheets | **Admin only** |
| `/restore CONFIRM` | Restore orders from Backup sheet | **Admin only** |

### For Customers

| Command / Button | Description |
|------------------|-------------|
| `/start verify_<token>` | Verify a warranty certificate (usually scanned via QR) |
| `📋 Статус замовлення` | Check the status of your current order |

## 🔐 Role Management

Roles (`ADMIN`, `MASTER`) are managed in the database or synchronized via the **Google Sheets** integration.

Initially, you may need to insert the first Admin manually into the database:
```sql
INSERT INTO "Employee" ("tgId", "name", "role", "isActive")
VALUES (YOUR_TELEGRAM_ID, 'Admin Name', 'ADMIN', true);
```

## 🏗️ Project Structure

```bash
src/
├── common/             # Domain logic, events, guards, & exceptions
├── config/             # Environment configuration
├── modules/
│   ├── auth/           # Authentication service
│   ├── bot/            # Telegram bot logic (Commands, Handlers, Flows)
│   ├── integrations/   # External APIs (Google Sheets)
│   ├── mail/           # Email sending service
│   ├── notifications/  # Notification strategies
│   ├── orders/         # Order business logic & CRUD
│   ├── pdf/            # PDF generation (Fonts, Icons, Generators)
│   └── warranty/       # Warranty verification logic
├── prisma/             # Database connection & schema
└── main.ts             # Application entry point
```

## 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">
  <sub>Built with ❤️ for Dnipro Tire Services</sub>
</div>

