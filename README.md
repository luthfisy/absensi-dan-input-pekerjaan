# Sistem Absensi dan Input Kegiatan

Aplikasi web absensi dan input kegiatan harian berbasis **Google Apps Script** — GPS tracking, manajemen role tiga tingkat, statistik real-time, tanpa server dan tanpa biaya infrastruktur.

![Preview](assets/absensi-dan-input-pekerjaan.jpg)

---

## Fitur

### Absensi
- Absen masuk & pulang dengan timestamp server (Asia/Jakarta)
- GPS tracking — koordinat lokasi dicatat otomatis (opsional, dengan izin browser)
- Status kehadiran: **Hadir / WFO**, **WFH**, **Izin**, **Sakit**
- Jam operasional dikunci 07:00–20:00 WIB di sisi server
- Link Google Maps langsung dari tabel rekap

### Input Kegiatan Harian
- Form lengkap: jenis kegiatan, detail pekerjaan, waktu mulai/selesai, status progres
- Field tambahan: instansi, PIC, alamat, link bukti, kendala
- Riwayat kegiatan dengan filter tanggal dan paginasi (10/25/50 baris)
- ID kegiatan unik digenerate otomatis

### Manajemen Role

| Role | Akses |
|---|---|
| **User** | Dashboard, absensi, input & riwayat kegiatan sendiri, ubah password |
| **Admin** | + Kelola user, kelola kategori kegiatan |
| **Owner** | + Rekap semua absensi, semua kegiatan seluruh tim |

### Statistik Publik
- Halaman statistik tanpa login (`?page=statistik`)
- Jumlah kehadiran hari ini + grafik tren 7 hari terakhir

### Keamanan & Teknis
- Password di-hash SHA-256 dengan auto-upgrade dari plain text
- Session timeout 6 jam tidak aktif
- `LockService` pada setiap operasi tulis (anti race condition)
- Validasi role di server, tidak bisa di-bypass frontend
- PWA-ready — bisa di-install di HP tanpa Play Store / App Store

---

## Teknologi

| Komponen | Detail |
|---|---|
| Backend | Google Apps Script V8 Runtime |
| Database | Google Sheets |
| Frontend | HTML / CSS / Vanilla JavaScript |
| UI | Bootstrap 5.3 + Bootstrap Icons 1.11 |
| Notifikasi | SweetAlert2 v11 |
| Deploy CLI | [clasp](https://github.com/google/clasp) |

**Struktur Sheets:**

| Sheet | Fungsi |
|---|---|
| `Users` | Akun, password hash SHA-256, role, status |
| `Absensi` | Rekap kehadiran + koordinat GPS masuk & pulang |
| `Input Aktivitas` | Log kegiatan harian (14 kolom) |
| `Referensi` | Daftar kategori kegiatan |

---

## Setup

### Prasyarat
- Akun Google (Gmail / Google Workspace)
- [Node.js](https://nodejs.org) (untuk clasp)
- clasp: `npm install -g @google/clasp`

### 1. Clone Repository

```bash
git clone https://github.com/luthfisy/absensi-dan-input-pekerjaan.git
cd absensi-dan-input-pekerjaan
```

### 2. Buat Google Spreadsheet

1. Buka [Google Sheets](https://sheets.google.com) dan buat spreadsheet baru
2. Salin **Spreadsheet ID** dari URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_ADA_DI_SINI/edit
   ```
3. Buka `Code.gs` dan ganti nilai `SPREADSHEET_ID`:
   ```javascript
   const SPREADSHEET_ID = 'ganti_dengan_id_spreadsheet_anda';
   ```

### 3. Push ke Google Apps Script

Login ke clasp dan push semua file:

```bash
clasp login
clasp create --type webapp --title "Absensi dan Input Kegiatan"
clasp push --force
```

> Setelah `clasp create`, Script ID baru otomatis tersimpan di `.clasp.json`.

### 4. Inisialisasi Spreadsheet

1. Buka [script.google.com](https://script.google.com) dan cari project yang baru dibuat
2. Jalankan fungsi `setupSheets()` dari editor: **Run → Run function → setupSheets**
3. Izinkan akses yang diminta Google (baca/tulis Spreadsheet)

Fungsi ini membuat keempat sheet dengan header yang benar, mengisi contoh kategori kegiatan, dan membuat **dua akun default**:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Owner |
| `adminsys` | `admin123` | Admin |

> **Ganti password default segera setelah pertama kali login.**

### 5. Deploy sebagai Web App

1. Di editor GAS: **Deploy → New deployment**
2. Pilih tipe: **Web app**
3. Atur:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Klik **Deploy** — salin URL yang muncul

URL web app siap dibagikan ke tim.

---

## Penggunaan clasp (Opsional)

Untuk push perubahan kode tanpa buka editor GAS secara manual:

```bash
# Push semua file ke GAS
clasp push --force

# Lihat daftar deployment
clasp deployments

# Update deployment produksi ke versi terbaru
clasp deploy -i DEPLOYMENT_ID -d "deskripsi versi"
```

---

## Struktur File

```
├── Code.gs          # Backend — semua fungsi server-side
├── Index.html       # Template HTML utama (shell SPA)
├── css.html         # Stylesheet (emerald theme + Bootstrap)
├── js.html          # Frontend JavaScript (App object)
├── appsscript.json  # Konfigurasi GAS (timezone, runtime, webapp)
└── .gitignore
```

---

## URL Halaman Statistik Publik

Tambahkan `?page=statistik` di akhir URL web app untuk membuka halaman statistik tanpa login:

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=statistik
```

---

## Lisensi

[MIT](LICENSE) — bebas digunakan dan dimodifikasi.

---

## Developer

**SASHINDO PROJECT** — Luthfi SY  
[sashindo.web.id](https://sashindo.web.id) · WhatsApp +6281235025700
