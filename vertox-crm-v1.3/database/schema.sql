/* =========================================================
   VERTOX CRM - MSSQL DATABASE SCHEMA
   Run this whole file in SQL Server Management Studio (SSMS)
   or via sqlcmd against a fresh SQL Server instance.
   ========================================================= */

IF DB_ID('VertoxCRM') IS NULL
BEGIN
    CREATE DATABASE VertoxCRM;
END
GO

USE VertoxCRM;
GO

/* ---------------------------------------------------------
   ROLES  (dynamic - admin can create new roles from UI)
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Roles','U') IS NULL
CREATE TABLE dbo.Roles (
    RoleId          INT IDENTITY(1,1) PRIMARY KEY,
    RoleName        NVARCHAR(100) NOT NULL UNIQUE,
    Description     NVARCHAR(255) NULL,
    IsSystem        BIT NOT NULL DEFAULT 0,      -- system roles cannot be deleted
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------
   PERMISSIONS (module + action level, dynamic)
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Permissions','U') IS NULL
CREATE TABLE dbo.Permissions (
    PermissionId    INT IDENTITY(1,1) PRIMARY KEY,
    PermKey         NVARCHAR(100) NOT NULL UNIQUE,   -- e.g. users.create, leads.view
    Module          NVARCHAR(100) NOT NULL,
    Action          NVARCHAR(50)  NOT NULL,
    Description     NVARCHAR(255) NULL
);
GO

IF OBJECT_ID('dbo.RolePermissions','U') IS NULL
CREATE TABLE dbo.RolePermissions (
    RoleId          INT NOT NULL FOREIGN KEY REFERENCES dbo.Roles(RoleId) ON DELETE CASCADE,
    PermissionId    INT NOT NULL FOREIGN KEY REFERENCES dbo.Permissions(PermissionId) ON DELETE CASCADE,
    PRIMARY KEY (RoleId, PermissionId)
);
GO

/* ---------------------------------------------------------
   USERS
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Users','U') IS NULL
CREATE TABLE dbo.Users (
    UserId          INT IDENTITY(1,1) PRIMARY KEY,
    Username        NVARCHAR(100) NOT NULL UNIQUE,
    Email           NVARCHAR(150) NULL UNIQUE,
    FullName        NVARCHAR(150) NULL,
    PasswordHash    NVARCHAR(255) NOT NULL,
    RoleId          INT NOT NULL FOREIGN KEY REFERENCES dbo.Roles(RoleId),
    Status          NVARCHAR(20) NOT NULL DEFAULT 'active',  -- active / inactive / suspended
    Avatar          NVARCHAR(255) NULL,
    Theme           NVARCHAR(20) NOT NULL DEFAULT 'light',   -- light / dark, user preference
    LastLoginAt     DATETIME2 NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.RefreshTokens','U') IS NULL
CREATE TABLE dbo.RefreshTokens (
    TokenId         INT IDENTITY(1,1) PRIMARY KEY,
    UserId          INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    Token           NVARCHAR(500) NOT NULL,
    ExpiresAt       DATETIME2 NOT NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Revoked         BIT NOT NULL DEFAULT 0
);
GO

IF OBJECT_ID('dbo.AuditLogs','U') IS NULL
CREATE TABLE dbo.AuditLogs (
    LogId           BIGINT IDENTITY(1,1) PRIMARY KEY,
    UserId          INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    Action          NVARCHAR(100) NOT NULL,
    Module          NVARCHAR(100) NULL,
    RecordId        NVARCHAR(50) NULL,
    Details         NVARCHAR(MAX) NULL,
    IpAddress       NVARCHAR(50) NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------
   DYNAMIC MODULES + FIELDS
   Har CRM module (Contacts, Leads, Deals...) ke fields
   database-driven hain, taake UI se field add/remove/edit
   ho sake bina code change kiye.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Modules','U') IS NULL
CREATE TABLE dbo.Modules (
    ModuleId        INT IDENTITY(1,1) PRIMARY KEY,
    ModuleKey       NVARCHAR(100) NOT NULL UNIQUE,   -- contacts, leads, deals
    Label           NVARCHAR(150) NOT NULL,
    Icon            NVARCHAR(50) NULL,
    IsSystem        BIT NOT NULL DEFAULT 0,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.ModuleFields','U') IS NULL
CREATE TABLE dbo.ModuleFields (
    FieldId         INT IDENTITY(1,1) PRIMARY KEY,
    ModuleId        INT NOT NULL FOREIGN KEY REFERENCES dbo.Modules(ModuleId) ON DELETE CASCADE,
    FieldKey        NVARCHAR(100) NOT NULL,          -- machine name, e.g. phone_number
    Label           NVARCHAR(150) NOT NULL,          -- display label
    FieldType       NVARCHAR(30)  NOT NULL,          -- text, number, decimal, date, datetime, select, multiselect, textarea, checkbox, email, phone, url, currency
    Options         NVARCHAR(MAX) NULL,              -- JSON array for select/multiselect options
    Config          NVARCHAR(MAX) NULL,              -- JSON: {min,max,step,decimals,defaultValue,placeholder,helpText,unique,prefix,suffix}
    IsRequired      BIT NOT NULL DEFAULT 0,
    IsDefault       BIT NOT NULL DEFAULT 0,          -- core/system field (name, email) not deletable
    SortOrder       INT NOT NULL DEFAULT 0,
    ShowInList      BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_ModuleField UNIQUE(ModuleId, FieldKey)
);
GO

-- Safe for databases created before Config existed — adds the column without touching existing data.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ModuleFields') AND name = 'Config')
    ALTER TABLE dbo.ModuleFields ADD Config NVARCHAR(MAX) NULL;
GO

/* ---------------------------------------------------------
   RECORDS  - generic storage for module data.
   Har record ka core data (name/status/owner) columns mein,
   baqi tamam dynamic field values JSON mein (FieldsJson).
   Ye approach fields ko fully-dynamic banati hai bina
   baar baar ALTER TABLE kiye.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Records','U') IS NULL
CREATE TABLE dbo.Records (
    RecordId        INT IDENTITY(1,1) PRIMARY KEY,
    ModuleId        INT NOT NULL FOREIGN KEY REFERENCES dbo.Modules(ModuleId),
    Title           NVARCHAR(255) NULL,              -- primary display name
    OwnerId         INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    Status          NVARCHAR(50) NULL,
    FieldsJson      NVARCHAR(MAX) NOT NULL DEFAULT '{}',  -- {"field_key": "value", ...}
    CreatedBy       INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Records_Module' AND object_id = OBJECT_ID('dbo.Records'))
    CREATE INDEX IX_Records_Module ON dbo.Records(ModuleId);
GO

-- ---------------------------------------------------------
-- PERFORMANCE INDEXES — added for large-scale deployments.
-- Every list/report/export query filters by ModuleId and sorts by
-- CreatedAt DESC, and the dashboard/report queries group by Status —
-- these composite + covering indexes let SQL Server answer both straight
-- from the index instead of scanning the whole Records table, which is
-- what actually keeps things fast once a module holds millions of rows.
-- Safe to run on an existing database: CREATE INDEX is guarded so re-
-- running schema.sql won't error if these already exist.
-- ---------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Records_Module_CreatedAt' AND object_id = OBJECT_ID('dbo.Records'))
    CREATE INDEX IX_Records_Module_CreatedAt ON dbo.Records(ModuleId, CreatedAt DESC) INCLUDE (Title, Status, OwnerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Records_Module_Status' AND object_id = OBJECT_ID('dbo.Records'))
    CREATE INDEX IX_Records_Module_Status ON dbo.Records(ModuleId, Status) INCLUDE (CreatedAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Records_CreatedAt' AND object_id = OBJECT_ID('dbo.Records'))
    CREATE INDEX IX_Records_CreatedAt ON dbo.Records(CreatedAt DESC);
GO

/* ---------------------------------------------------------
   SYSTEM SETTINGS  (site name, theme, logo - UI editable)
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Settings','U') IS NULL
CREATE TABLE dbo.Settings (
    SettingKey      NVARCHAR(100) PRIMARY KEY,
    SettingValue    NVARCHAR(MAX) NULL,
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------
   VOLUNTEER SHIFT SCHEDULING
   Har shift ek Volunteers-module Record se link hoti hai
   (VolunteerRecordId), aur optionally ek Projects-module
   Record se (ProjectRecordId). Overlap/conflict detection
   controller layer mein hoti hai (same volunteer, same date,
   overlapping start/end time -> reject) taake double-booking
   na ho.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.VolunteerShifts','U') IS NULL
CREATE TABLE dbo.VolunteerShifts (
    ShiftId          INT IDENTITY(1,1) PRIMARY KEY,
    VolunteerRecordId INT NOT NULL FOREIGN KEY REFERENCES dbo.Records(RecordId) ON DELETE CASCADE,
    ProjectRecordId  INT NULL FOREIGN KEY REFERENCES dbo.Records(RecordId),
    ShiftDate        DATE NOT NULL,
    StartTime        VARCHAR(5) NOT NULL,   -- 'HH:MM' 24hr
    EndTime          VARCHAR(5) NOT NULL,   -- 'HH:MM' 24hr
    Role             NVARCHAR(150) NULL,
    Location         NVARCHAR(255) NULL,
    Status           NVARCHAR(20) NOT NULL DEFAULT 'Scheduled', -- Scheduled / Completed / No-Show / Cancelled
    Notes            NVARCHAR(500) NULL,
    CreatedBy        INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VolunteerShifts_Volunteer' AND object_id = OBJECT_ID('dbo.VolunteerShifts'))
    CREATE INDEX IX_VolunteerShifts_Volunteer ON dbo.VolunteerShifts(VolunteerRecordId, ShiftDate);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VolunteerShifts_Date' AND object_id = OBJECT_ID('dbo.VolunteerShifts'))
    CREATE INDEX IX_VolunteerShifts_Date ON dbo.VolunteerShifts(ShiftDate);
GO

/* ---------------------------------------------------------
   GRANT MILESTONES / SUB-TASKS
   Har milestone ek Grants-module Record se link hota hai.
   Status khud-ba-khud 'Overdue' dikhta hai (computed at read
   time) agar DueDate guzar chuki ho aur Completed na ho.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.GrantMilestones','U') IS NULL
CREATE TABLE dbo.GrantMilestones (
    MilestoneId      INT IDENTITY(1,1) PRIMARY KEY,
    GrantRecordId    INT NOT NULL FOREIGN KEY REFERENCES dbo.Records(RecordId) ON DELETE CASCADE,
    Title            NVARCHAR(255) NOT NULL,
    Description      NVARCHAR(1000) NULL,
    DueDate          DATE NULL,
    Status           NVARCHAR(20) NOT NULL DEFAULT 'Pending',  -- Pending / In Progress / Completed
    CompletedAt      DATETIME2 NULL,
    SortOrder        INT NOT NULL DEFAULT 0,
    CreatedBy        INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GrantMilestones_Grant' AND object_id = OBJECT_ID('dbo.GrantMilestones'))
    CREATE INDEX IX_GrantMilestones_Grant ON dbo.GrantMilestones(GrantRecordId);
GO

/* ---------------------------------------------------------
   RECURRING DONATION SCHEDULE + REMINDER ENGINE
   Ye sirf ek checkbox nahi — DonationSchedules mein har
   recurring donation ka apna cadence (Weekly/Monthly/
   Quarterly/Yearly) aur NextDueDate store hoti hai. Server
   (backend/utils/reminderScheduler.js) roz khud check karta
   hai: jis schedule ki NextDueDate aaj/guzar chuki ho, uske
   liye ek DonationReminders row generate ho jaati hai
   (agar pehle se nahi bani) aur NextDueDate agle cycle par
   khud aage badh jaati hai — bina kisi manual click ke.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.DonationSchedules','U') IS NULL
CREATE TABLE dbo.DonationSchedules (
    ScheduleId       INT IDENTITY(1,1) PRIMARY KEY,
    DonationRecordId INT NULL FOREIGN KEY REFERENCES dbo.Records(RecordId) ON DELETE SET NULL,
    DonorName        NVARCHAR(255) NOT NULL,
    Amount           DECIMAL(18,2) NOT NULL,
    CurrencyCode     NVARCHAR(3) NULL FOREIGN KEY REFERENCES dbo.Currencies(CurrencyCode),
    Frequency        NVARCHAR(20) NOT NULL,  -- Weekly / Monthly / Quarterly / Yearly
    StartDate        DATE NOT NULL,
    NextDueDate      DATE NOT NULL,
    LastGeneratedAt  DATETIME2 NULL,
    Status           NVARCHAR(20) NOT NULL DEFAULT 'Active', -- Active / Paused / Cancelled
    Notes            NVARCHAR(500) NULL,
    CreatedBy        INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DonationSchedules_NextDue' AND object_id = OBJECT_ID('dbo.DonationSchedules'))
    CREATE INDEX IX_DonationSchedules_NextDue ON dbo.DonationSchedules(NextDueDate, Status);
GO

IF OBJECT_ID('dbo.DonationReminders','U') IS NULL
CREATE TABLE dbo.DonationReminders (
    ReminderId       INT IDENTITY(1,1) PRIMARY KEY,
    ScheduleId       INT NOT NULL FOREIGN KEY REFERENCES dbo.DonationSchedules(ScheduleId) ON DELETE CASCADE,
    DueDate          DATE NOT NULL,
    Status           NVARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending / Sent / Dismissed / Collected
    GeneratedAt      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ActionedAt       DATETIME2 NULL,
    ActionedBy       INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    -- Ek schedule ke ek hi DueDate ke liye sirf ek reminder bane — scheduler
    -- ko roz chalne par bhi duplicate reminders banane se rokta hai.
    CONSTRAINT UQ_Reminder_Schedule_Date UNIQUE(ScheduleId, DueDate)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DonationReminders_Status' AND object_id = OBJECT_ID('dbo.DonationReminders'))
    CREATE INDEX IX_DonationReminders_Status ON dbo.DonationReminders(Status, DueDate);
GO

/* ---------------------------------------------------------
   MULTI-CURRENCY / FINANCIAL LEDGER
   NGOs jo foreign grants (USD, EUR) aur local currency dono
   manage karte hain, unke liye currency master + a simple
   double-entry-lite ledger. Har ledger entry apni original
   currency mein amount store karti hai PLUS us waqt ki
   exchange rate ka snapshot (ExchangeRate) aur base-currency
   equivalent (AmountBase) — is tarah rate baad mein badal
   jaye to bhi purani entries ka history accurate rehta hai.
   --------------------------------------------------------- */
IF OBJECT_ID('dbo.Currencies','U') IS NULL
CREATE TABLE dbo.Currencies (
    CurrencyCode        NVARCHAR(3) PRIMARY KEY,        -- USD, EUR, PKR...
    CurrencyName         NVARCHAR(100) NOT NULL,
    Symbol               NVARCHAR(10) NULL,
    ExchangeRateToBase   DECIMAL(18,6) NOT NULL DEFAULT 1,  -- 1 unit of this currency = X base currency
    IsBase               BIT NOT NULL DEFAULT 0,
    CreatedAt            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.LedgerEntries','U') IS NULL
CREATE TABLE dbo.LedgerEntries (
    EntryId         INT IDENTITY(1,1) PRIMARY KEY,
    EntryDate       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    EntryType       NVARCHAR(20) NOT NULL,             -- grant, income, expense
    Description     NVARCHAR(255) NOT NULL,
    Reference       NVARCHAR(150) NULL,                -- donor / grant reference, invoice #, etc.
    CurrencyCode    NVARCHAR(3) NOT NULL FOREIGN KEY REFERENCES dbo.Currencies(CurrencyCode),
    Amount          DECIMAL(18,2) NOT NULL,            -- amount in CurrencyCode
    ExchangeRate    DECIMAL(18,6) NOT NULL,             -- snapshot of rate-to-base at entry time
    AmountBase      DECIMAL(18,2) NOT NULL,             -- Amount * ExchangeRate, in base currency
    CreatedBy       INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId),
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LedgerEntries_Date' AND object_id = OBJECT_ID('dbo.LedgerEntries'))
    CREATE INDEX IX_LedgerEntries_Date ON dbo.LedgerEntries(EntryDate);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LedgerEntries_Currency' AND object_id = OBJECT_ID('dbo.LedgerEntries'))
    CREATE INDEX IX_LedgerEntries_Currency ON dbo.LedgerEntries(CurrencyCode);
GO

/* =========================================================
   SEED DATA
   ========================================================= */

-- Roles
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName='SuperAdmin')
    INSERT INTO dbo.Roles (RoleName, Description, IsSystem) VALUES ('SuperAdmin','Full system access, cannot be removed',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName='Admin')
    INSERT INTO dbo.Roles (RoleName, Description, IsSystem) VALUES ('Admin','Manage users and CRM data',0);
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName='Manager')
    INSERT INTO dbo.Roles (RoleName, Description, IsSystem) VALUES ('Manager','Manage own team records',0);
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName='Staff')
    INSERT INTO dbo.Roles (RoleName, Description, IsSystem) VALUES ('Staff','Basic access to assigned records',0);
GO

-- Permissions (core set; more can be added dynamically by app logic)
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions)
BEGIN
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES
    ('users.view','users','view','View users'),
    ('users.create','users','create','Create users'),
    ('users.edit','users','edit','Edit users'),
    ('users.delete','users','delete','Delete users'),
    ('roles.manage','roles','manage','Manage roles & permissions'),
    ('settings.manage','settings','manage','Manage system settings'),
    ('modules.manage','modules','manage','Manage dynamic modules/fields'),
    ('records.view','records','view','View CRM records'),
    ('records.create','records','create','Create CRM records'),
    ('records.edit','records','edit','Edit CRM records'),
    ('records.delete','records','delete','Delete CRM records'),
    ('audit.view','audit','view','View audit trail / activity logs');
END
GO

-- Added later: ensure audit.view exists even on databases that were created
-- before this permission was introduced (the block above only inserts when
-- the Permissions table is completely empty).
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='audit.view')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('audit.view','audit','view','View audit trail / activity logs');
GO

-- Added later: multi-currency / financial ledger permissions (same pattern
-- as audit.view above, so existing databases pick these up on re-run).
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='ledger.view')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('ledger.view','ledger','view','View financial ledger & currencies');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='ledger.manage')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('ledger.manage','ledger','manage','Create/edit ledger entries & manage currencies');
GO

-- Added later: volunteer shift scheduling, grant milestones, and the
-- recurring-donation reminder engine — same "insert if missing" pattern so
-- existing databases pick these up on re-run without losing data.
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='shifts.view')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('shifts.view','shifts','view','View volunteer shift schedule');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='shifts.manage')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('shifts.manage','shifts','manage','Create/edit/cancel volunteer shifts');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='milestones.view')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('milestones.view','milestones','view','View grant milestones');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='milestones.manage')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('milestones.manage','milestones','manage','Create/edit grant milestones');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='reminders.view')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('reminders.view','reminders','view','View recurring donation schedules & reminders');
IF NOT EXISTS (SELECT 1 FROM dbo.Permissions WHERE PermKey='reminders.manage')
    INSERT INTO dbo.Permissions (PermKey, Module, Action, Description) VALUES ('reminders.manage','reminders','manage','Create/edit recurring donation schedules, action reminders');
GO

-- Give SuperAdmin ALL permissions
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Roles r CROSS JOIN dbo.Permissions p
WHERE r.RoleName='SuperAdmin'
AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId=r.RoleId AND rp.PermissionId=p.PermissionId);
GO

-- Default SuperAdmin user
-- username: genzeadmin   password: genzeadmin@10
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Username='genzeadmin')
INSERT INTO dbo.Users (Username, Email, FullName, PasswordHash, RoleId, Status)
SELECT 'genzeadmin', 'admin@vertoxcrm.local', 'Super Admin',
       '$2b$10$OFZZJpKRDRxg/niD3WTlKua7a.jTE3OyGg27/QjaUsRXAXWsNUFhS',
       RoleId, 'active'
FROM dbo.Roles WHERE RoleName='SuperAdmin';
GO

-- Default modules
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='contacts')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('contacts','Contacts','user',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='leads')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('leads','Leads','target',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='deals')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('deals','Deals','briefcase',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='beneficiaries')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('beneficiaries','Beneficiaries','users',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='donors')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('donors','Donors','heart',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='donations')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('donations','Donations','gift',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='volunteers')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('volunteers','Volunteers','hand',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='projects')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('projects','Projects / Programs','folder',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='events')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('events','Events','calendar',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='grants')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('grants','Grants','award',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='cases')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('cases','Cases / Tasks','clipboard',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='staff')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('staff','Staff / Employees','id-badge',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='payroll')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('payroll','Payroll','wallet',1);
GO

-- Added later: additional modules commonly needed by NGOs worldwide
-- (inventory/assets, partner orgs, accountability/complaints mechanism,
-- training & certifications, outreach campaigns, governance/board).
-- Same dynamic Modules+ModuleFields system as everything else — fully
-- editable from the Modules & Fields screen, no code changes needed.
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='inventory')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('inventory','Inventory / Assets','box',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='partners')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('partners','Partner Organizations','handshake',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='complaints')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('complaints','Complaints & Feedback','alert-circle',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='training')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('training','Training & Certifications','graduation-cap',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='campaigns')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('campaigns','Campaigns / Outreach','megaphone',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='governance')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('governance','Board / Governance','landmark',1);
GO

-- Added later still: rounding out the "complete NGO package" — branches /
-- field offices (multi-location NGOs), sponsorship programs, donation
-- pledges, fleet/vehicles, vendors & procurement, board meeting minutes,
-- legal/compliance document tracking, and needs-assessment surveys. Same
-- dynamic Modules+ModuleFields engine, zero code changes needed to use them.
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='branches')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('branches','Branches / Field Offices','map-pin',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='sponsorships')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('sponsorships','Sponsorships','heart',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='pledges')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('pledges','Donation Pledges','clipboard-check',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='fleet')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('fleet','Fleet / Vehicles','truck',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='vendors')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('vendors','Vendors / Procurement','shopping-cart',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='meetings')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('meetings','Meetings / Minutes','users',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='compliance')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('compliance','Legal / Compliance Docs','shield-check',1);
IF NOT EXISTS (SELECT 1 FROM dbo.Modules WHERE ModuleKey='surveys')
    INSERT INTO dbo.Modules (ModuleKey, Label, Icon, IsSystem) VALUES ('surveys','Surveys / Needs Assessment','clipboard-list',1);
GO

-- Default fields for Contacts
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='contacts')
BEGIN
    DECLARE @cid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='contacts');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, IsRequired, IsDefault, SortOrder) VALUES
    (@cid,'full_name','Full Name','text',1,1,1),
    (@cid,'email','Email','email',0,1,2),
    (@cid,'phone','Phone','phone',0,1,3),
    (@cid,'company','Company','text',0,0,4),
    (@cid,'notes','Notes','textarea',0,0,5);
END
GO

-- Default fields for Leads
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='leads')
BEGIN
    DECLARE @lid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='leads');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@lid, 'lead_name', 'Lead Name', 'text', NULL, NULL, 1, 1, 1),
    (@lid, 'source', 'Source', 'select', '["Website","Referral","Social Media","Cold Call","Other"]', NULL, 0, 1, 2),
    (@lid, 'stage', 'Stage', 'select', '["New","Contacted","Qualified","Lost"]', NULL, 0, 1, 3),
    (@lid, 'email', 'Email', 'email', NULL, NULL, 0, 1, 4),
    (@lid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 5);
END
GO

-- Default fields for Deals
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='deals')
BEGIN
    DECLARE @did INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='deals');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@did, 'deal_name', 'Deal Name', 'text', NULL, NULL, 1, 1, 1),
    (@did, 'amount', 'Amount', 'number', NULL, NULL, 0, 1, 2),
    (@did, 'stage', 'Stage', 'select', '["Prospecting","Proposal","Negotiation","Won","Lost"]', NULL, 0, 1, 3),
    (@did, 'close_date', 'Close Date', 'date', NULL, NULL, 0, 1, 4);
END
GO

-- Default fields for Beneficiaries
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='beneficiaries')
BEGIN
    DECLARE @bid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='beneficiaries');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@bid, 'full_name', 'Full Name', 'text', NULL, NULL, 1, 1, 1),
    (@bid, 'cnic', 'CNIC / ID Number', 'text', NULL, '{"unique":true,"helpText":"13-digit national ID, must be unique per beneficiary"}', 0, 1, 2),
    (@bid, 'gender', 'Gender', 'select', '["Male","Female","Other"]', NULL, 0, 1, 3),
    (@bid, 'date_of_birth', 'Date of Birth', 'date', NULL, NULL, 0, 1, 4),
    (@bid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 5),
    (@bid, 'address', 'Address', 'textarea', NULL, NULL, 0, 1, 6),
    (@bid, 'category', 'Category', 'select', '["Widow","Orphan","Disabled","Elderly","Refugee","Other"]', NULL, 0, 1, 7),
    (@bid, 'family_members', 'Family Members', 'number', NULL, NULL, 0, 1, 8),
    (@bid, 'monthly_income', 'Monthly Income', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 9),
    (@bid, 'assistance_type', 'Assistance Type', 'select', '["Food","Cash Aid","Education","Medical","Shelter","Other"]', NULL, 0, 1, 10),
    (@bid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 11);
END
GO

-- Default fields for Donors
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='donors')
BEGIN
    DECLARE @donid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='donors');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@donid, 'donor_name', 'Donor Name', 'text', NULL, NULL, 1, 1, 1),
    (@donid, 'donor_type', 'Donor Type', 'select', '["Individual","Organization","Corporate","Government"]', NULL, 0, 1, 2),
    (@donid, 'email', 'Email', 'email', NULL, '{"unique":true}', 0, 1, 3),
    (@donid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 4),
    (@donid, 'address', 'Address', 'textarea', NULL, NULL, 0, 1, 5),
    (@donid, 'total_donated', 'Total Donated', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 6),
    (@donid, 'tax_exempt_number', 'Tax Exemption / NTN Number', 'text', NULL, '{"helpText":"For donation tax-receipt purposes"}', 0, 1, 8),
    (@donid, 'preferred_contact', 'Preferred Contact Method', 'select', '["Email","Phone","WhatsApp","Mail"]', NULL, 0, 1, 7);
END
GO

-- Default fields for Donations
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='donations')
BEGIN
    DECLARE @donaid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='donations');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@donaid, 'donor_name', 'Donor Name', 'text', NULL, NULL, 1, 1, 1),
    (@donaid, 'amount', 'Amount', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":1}', 1, 1, 2),
    (@donaid, 'donation_type', 'Donation Type', 'select', '["Cash","In-Kind","Online","Bank Transfer","Cheque"]', NULL, 0, 1, 3),
    (@donaid, 'purpose', 'Purpose / Campaign', 'text', NULL, NULL, 0, 1, 4),
    (@donaid, 'donation_date', 'Donation Date', 'date', NULL, NULL, 0, 1, 5),
    (@donaid, 'receipt_number', 'Receipt Number', 'text', NULL, '{"unique":true,"helpText":"Auto/manual receipt number, must be unique"}', 0, 1, 6),
    (@donaid, 'is_recurring', 'Recurring Donation', 'checkbox', NULL, NULL, 0, 1, 7),
    (@donaid, 'payment_method', 'Payment Method', 'select', '["Cash","Bank Transfer","Credit Card","Mobile Wallet","Cheque"]', NULL, 0, 1, 8);
END
GO

-- Default fields for Volunteers
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='volunteers')
BEGIN
    DECLARE @volid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='volunteers');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@volid, 'full_name', 'Full Name', 'text', NULL, NULL, 1, 1, 1),
    (@volid, 'email', 'Email', 'email', NULL, '{"unique":true}', 0, 1, 2),
    (@volid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 3),
    (@volid, 'skills', 'Skills', 'text', NULL, NULL, 0, 1, 4),
    (@volid, 'availability', 'Availability', 'select', '["Full-time","Part-time","Weekends","On-call"]', NULL, 0, 1, 5),
    (@volid, 'assigned_project', 'Assigned Project', 'text', NULL, NULL, 0, 1, 6),
    (@volid, 'join_date', 'Join Date', 'date', NULL, NULL, 0, 1, 7),
    (@volid, 'hours_contributed', 'Hours Contributed', 'number', NULL, '{"min":0,"suffix":"hrs"}', 0, 1, 8);
END
GO

-- Default fields for Projects / Programs
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='projects')
BEGIN
    DECLARE @prjid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='projects');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@prjid, 'project_name', 'Project Name', 'text', NULL, NULL, 1, 1, 1),
    (@prjid, 'category', 'Category', 'select', '["Education","Health","Relief","Livelihood","Water & Sanitation","Other"]', NULL, 0, 1, 2),
    (@prjid, 'location', 'Location', 'text', NULL, NULL, 0, 1, 3),
    (@prjid, 'start_date', 'Start Date', 'date', NULL, NULL, 0, 1, 4),
    (@prjid, 'end_date', 'End Date', 'date', NULL, NULL, 0, 1, 5),
    (@prjid, 'budget', 'Budget', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 6),
    (@prjid, 'status', 'Status', 'select', '["Planning","Active","On Hold","Completed"]', NULL, 0, 1, 7);
END
GO

-- Default fields for Events
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='events')
BEGIN
    DECLARE @evtid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='events');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@evtid, 'event_name', 'Event Name', 'text', NULL, NULL, 1, 1, 1),
    (@evtid, 'event_date', 'Event Date', 'date', NULL, NULL, 0, 1, 2),
    (@evtid, 'location', 'Location', 'text', NULL, NULL, 0, 1, 3),
    (@evtid, 'organizer', 'Organizer', 'text', NULL, NULL, 0, 1, 4),
    (@evtid, 'expected_attendees', 'Expected Attendees', 'number', NULL, '{"min":0}', 0, 1, 5);
END
GO

-- Default fields for Grants
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='grants')
BEGIN
    DECLARE @grtid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='grants');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@grtid, 'grant_name', 'Grant Name', 'text', NULL, NULL, 1, 1, 1),
    (@grtid, 'funder', 'Funder / Donor Agency', 'text', NULL, NULL, 0, 1, 2),
    (@grtid, 'amount', 'Amount', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 3),
    (@grtid, 'start_date', 'Start Date', 'date', NULL, NULL, 0, 1, 4),
    (@grtid, 'end_date', 'End Date', 'date', NULL, NULL, 0, 1, 5),
    (@grtid, 'reporting_deadline', 'Reporting Deadline', 'date', NULL, NULL, 0, 1, 6),
    (@grtid, 'status', 'Status', 'select', '["Applied","Approved","Active","Closed","Rejected"]', NULL, 0, 1, 7);
END
GO

-- Default fields for Cases / Tasks
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='cases')
BEGIN
    DECLARE @caseid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='cases');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@caseid, 'case_title', 'Case Title', 'text', NULL, NULL, 1, 1, 1),
    (@caseid, 'assigned_to', 'Assigned To', 'text', NULL, NULL, 0, 1, 2),
    (@caseid, 'priority', 'Priority', 'select', '["Low","Medium","High","Urgent"]', NULL, 0, 1, 3),
    (@caseid, 'due_date', 'Due Date', 'date', NULL, NULL, 0, 1, 4),
    (@caseid, 'description', 'Description', 'textarea', NULL, NULL, 0, 1, 5);
END
GO

-- Default fields for Staff / Employees
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='staff')
BEGIN
    DECLARE @stfid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='staff');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@stfid, 'full_name', 'Full Name', 'text', NULL, NULL, 1, 1, 1),
    (@stfid, 'designation', 'Designation', 'text', NULL, NULL, 0, 1, 2),
    (@stfid, 'department', 'Department', 'select', '["Programs","Finance","HR","Admin","Fundraising","Field Operations","IT","Other"]', NULL, 0, 1, 3),
    (@stfid, 'employment_type', 'Employment Type', 'select', '["Full-time","Part-time","Contract","Consultant"]', NULL, 0, 1, 4),
    (@stfid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 5),
    (@stfid, 'email', 'Email', 'email', NULL, '{"unique":true}', 0, 1, 6),
    (@stfid, 'joining_date', 'Joining Date', 'date', NULL, NULL, 0, 1, 7),
    (@stfid, 'basic_salary', 'Basic Salary', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 8),
    (@stfid, 'bank_account', 'Bank Account Number', 'text', NULL, '{"unique":true}', 0, 1, 9);
END
GO

-- Default fields for Payroll
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='payroll')
BEGIN
    DECLARE @payid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='payroll');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@payid, 'staff_name', 'Staff Name', 'text', NULL, NULL, 1, 1, 1),
    (@payid, 'pay_period', 'Pay Period (Month/Year)', 'text', NULL, NULL, 1, 1, 2),
    (@payid, 'basic_salary', 'Basic Salary', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 3),
    (@payid, 'bonus', 'Bonus', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 4),
    (@payid, 'deductions', 'Deductions', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 5),
    (@payid, 'net_salary', 'Net Salary', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 6),
    (@payid, 'payment_date', 'Payment Date', 'date', NULL, NULL, 0, 1, 7),
    (@payid, 'payment_method', 'Payment Method', 'select', '["Bank Transfer","Cash","Cheque"]', NULL, 0, 1, 8),
    (@payid, 'payment_status', 'Payment Status', 'select', '["Paid","Pending","Hold"]', NULL, 0, 1, 9);
END
GO

-- Default fields for Inventory / Assets
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='inventory')
BEGIN
    DECLARE @invid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='inventory');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@invid, 'item_name', 'Item Name', 'text', NULL, NULL, 1, 1, 1),
    (@invid, 'category', 'Category', 'select', '["Vehicle","Equipment","IT / Electronics","Furniture","Medical Supplies","Food Stock","Office Supplies","Other"]', NULL, 0, 1, 2),
    (@invid, 'quantity', 'Quantity', 'number', NULL, '{"min":0}', 0, 1, 3),
    (@invid, 'unit', 'Unit', 'select', '["Piece","Box","Kg","Litre","Set","Carton"]', NULL, 0, 1, 4),
    (@invid, 'location', 'Storage Location', 'text', NULL, NULL, 0, 1, 5),
    (@invid, 'condition', 'Condition', 'select', '["New","Good","Fair","Needs Repair","Disposed"]', NULL, 0, 1, 6),
    (@invid, 'purchase_date', 'Purchase / Received Date', 'date', NULL, NULL, 0, 1, 7),
    (@invid, 'value', 'Estimated Value', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 8),
    (@invid, 'assigned_to', 'Assigned To / Project', 'text', NULL, NULL, 0, 1, 9),
    (@invid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Partner Organizations
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='partners')
BEGIN
    DECLARE @parid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='partners');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@parid, 'organization_name', 'Organization Name', 'text', NULL, NULL, 1, 1, 1),
    (@parid, 'partner_type', 'Partner Type', 'select', '["Implementing Partner","Donor Agency","Government","UN Agency","Corporate","Academic","Other"]', NULL, 0, 1, 2),
    (@parid, 'contact_person', 'Contact Person', 'text', NULL, NULL, 0, 1, 3),
    (@parid, 'email', 'Email', 'email', NULL, NULL, 0, 1, 4),
    (@parid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 5),
    (@parid, 'mou_status', 'MoU Status', 'select', '["Draft","Signed","Active","Expired","Terminated"]', NULL, 0, 1, 6),
    (@parid, 'partnership_start', 'Partnership Start Date', 'date', NULL, NULL, 0, 1, 7),
    (@parid, 'partnership_end', 'Partnership End Date', 'date', NULL, NULL, 0, 1, 8),
    (@parid, 'focus_areas', 'Focus Areas', 'multiselect', '["Education","Health","Relief","Livelihood","WASH","Protection","Advocacy"]', NULL, 0, 1, 9),
    (@parid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Complaints & Feedback (accountability-to-affected-populations mechanism)
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='complaints')
BEGIN
    DECLARE @cmpid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='complaints');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@cmpid, 'complainant_name', 'Complainant Name', 'text', NULL, '{"helpText":"Leave blank for anonymous complaints"}', 0, 1, 1),
    (@cmpid, 'contact_info', 'Contact Info', 'text', NULL, NULL, 0, 1, 2),
    (@cmpid, 'category', 'Category', 'select', '["Service Quality","Staff Conduct","Aid Distribution","Safeguarding","Fraud / Corruption","Other"]', NULL, 0, 1, 3),
    (@cmpid, 'is_anonymous', 'Anonymous', 'checkbox', NULL, NULL, 0, 1, 4),
    (@cmpid, 'date_received', 'Date Received', 'date', NULL, NULL, 0, 1, 5),
    (@cmpid, 'channel', 'Reported Via', 'select', '["In Person","Phone","Email","Suggestion Box","Hotline","Field Visit","Other"]', NULL, 0, 1, 6),
    (@cmpid, 'description', 'Description', 'textarea', NULL, NULL, 1, 1, 7),
    (@cmpid, 'assigned_to', 'Assigned To', 'text', NULL, NULL, 0, 1, 8),
    (@cmpid, 'status', 'Status', 'select', '["Received","Under Investigation","Resolved","Closed","Escalated"]', NULL, 0, 1, 9),
    (@cmpid, 'resolution', 'Resolution / Action Taken', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Training & Certifications
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='training')
BEGIN
    DECLARE @trnid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='training');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@trnid, 'training_title', 'Training / Certification Title', 'text', NULL, NULL, 1, 1, 1),
    (@trnid, 'trainee_name', 'Trainee Name', 'text', NULL, NULL, 0, 1, 2),
    (@trnid, 'audience', 'Audience', 'select', '["Staff","Volunteer","Beneficiary","Partner"]', NULL, 0, 1, 3),
    (@trnid, 'provider', 'Training Provider', 'text', NULL, NULL, 0, 1, 4),
    (@trnid, 'start_date', 'Start Date', 'date', NULL, NULL, 0, 1, 5),
    (@trnid, 'completion_date', 'Completion Date', 'date', NULL, NULL, 0, 1, 6),
    (@trnid, 'certificate_expiry', 'Certificate Expiry', 'date', NULL, NULL, 0, 1, 7),
    (@trnid, 'status', 'Status', 'select', '["Enrolled","In Progress","Completed","Expired","Failed"]', NULL, 0, 1, 8),
    (@trnid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 9);
END
GO

-- Default fields for Campaigns / Outreach
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='campaigns')
BEGIN
    DECLARE @campid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='campaigns');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@campid, 'campaign_name', 'Campaign Name', 'text', NULL, NULL, 1, 1, 1),
    (@campid, 'channels', 'Channels', 'multiselect', '["Social Media","Email","SMS","Print","Radio/TV","Event","Door-to-Door"]', NULL, 0, 1, 2),
    (@campid, 'objective', 'Objective', 'select', '["Fundraising","Awareness","Volunteer Recruitment","Advocacy","Beneficiary Outreach"]', NULL, 0, 1, 3),
    (@campid, 'start_date', 'Start Date', 'date', NULL, NULL, 0, 1, 4),
    (@campid, 'end_date', 'End Date', 'date', NULL, NULL, 0, 1, 5),
    (@campid, 'target_audience', 'Target Audience', 'text', NULL, NULL, 0, 1, 6),
    (@campid, 'budget', 'Budget', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 7),
    (@campid, 'reach', 'People Reached', 'number', NULL, '{"min":0}', 0, 1, 8),
    (@campid, 'funds_raised', 'Funds Raised', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 9),
    (@campid, 'status', 'Status', 'select', '["Planned","Active","Completed","Cancelled"]', NULL, 0, 1, 10);
END
GO

-- Default fields for Board / Governance
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='governance')
BEGIN
    DECLARE @govid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='governance');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@govid, 'member_name', 'Member Name', 'text', NULL, NULL, 1, 1, 1),
    (@govid, 'position', 'Position', 'select', '["Chairperson","Vice Chair","Secretary","Treasurer","Member","Advisor"]', NULL, 0, 1, 2),
    (@govid, 'email', 'Email', 'email', NULL, NULL, 0, 1, 3),
    (@govid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 4),
    (@govid, 'term_start', 'Term Start', 'date', NULL, NULL, 0, 1, 5),
    (@govid, 'term_end', 'Term End', 'date', NULL, NULL, 0, 1, 6),
    (@govid, 'expertise', 'Area of Expertise', 'text', NULL, NULL, 0, 1, 7),
    (@govid, 'status', 'Status', 'select', '["Active","Former","Emeritus"]', NULL, 0, 1, 8);
END
GO

-- Default fields for Branches / Field Offices
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='branches')
BEGIN
    DECLARE @brid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='branches');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@brid, 'branch_name', 'Branch / Office Name', 'text', NULL, NULL, 1, 1, 1),
    (@brid, 'branch_type', 'Type', 'select', '["Head Office","Regional Office","Field Office","Project Site","Warehouse"]', NULL, 0, 1, 2),
    (@brid, 'address', 'Address', 'textarea', NULL, NULL, 0, 1, 3),
    (@brid, 'city', 'City', 'text', NULL, NULL, 0, 1, 4),
    (@brid, 'country', 'Country', 'text', NULL, NULL, 0, 1, 5),
    (@brid, 'branch_manager', 'Branch Manager', 'text', NULL, NULL, 0, 1, 6),
    (@brid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 7),
    (@brid, 'email', 'Email', 'email', NULL, NULL, 0, 1, 8),
    (@brid, 'staff_count', 'Staff Count', 'number', NULL, '{"min":0}', 0, 1, 9),
    (@brid, 'coverage_area', 'Coverage Area', 'text', NULL, '{"helpText":"e.g. districts / union councils served"}', 0, 1, 10),
    (@brid, 'opening_date', 'Opening Date', 'date', NULL, NULL, 0, 1, 11),
    (@brid, 'status', 'Status', 'select', '["Active","Under Setup","Temporarily Closed","Closed"]', NULL, 0, 1, 12);
END
GO

-- Default fields for Sponsorships (e.g. child/family sponsorship programs)
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='sponsorships')
BEGIN
    DECLARE @spid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='sponsorships');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@spid, 'beneficiary_name', 'Beneficiary Name', 'text', NULL, '{"helpText":"Child / family / student being sponsored"}', 1, 1, 1),
    (@spid, 'sponsor_name', 'Sponsor Name', 'text', NULL, NULL, 0, 1, 2),
    (@spid, 'sponsor_contact', 'Sponsor Contact', 'text', NULL, NULL, 0, 1, 3),
    (@spid, 'program_type', 'Program Type', 'select', '["Education","Health","Family Support","Orphan Care","Livelihood"]', NULL, 0, 1, 4),
    (@spid, 'monthly_amount', 'Monthly Amount', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 5),
    (@spid, 'start_date', 'Sponsorship Start', 'date', NULL, NULL, 0, 1, 6),
    (@spid, 'end_date', 'Sponsorship End', 'date', NULL, NULL, 0, 1, 7),
    (@spid, 'status', 'Status', 'select', '["Active","Paused","Completed","Cancelled"]', NULL, 0, 1, 8),
    (@spid, 'branch', 'Branch / Office', 'text', NULL, NULL, 0, 1, 9),
    (@spid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Donation Pledges (committed but not yet received)
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='pledges')
BEGIN
    DECLARE @plid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='pledges');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@plid, 'pledger_name', 'Pledger Name', 'text', NULL, NULL, 1, 1, 1),
    (@plid, 'pledge_amount', 'Pledged Amount', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 1, 1, 2),
    (@plid, 'amount_received', 'Amount Received So Far', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 3),
    (@plid, 'purpose', 'Purpose / Campaign', 'text', NULL, NULL, 0, 1, 4),
    (@plid, 'pledge_date', 'Pledge Date', 'date', NULL, NULL, 0, 1, 5),
    (@plid, 'due_date', 'Payment Due Date', 'date', NULL, NULL, 0, 1, 6),
    (@plid, 'status', 'Status', 'select', '["Pledged","Partially Paid","Fulfilled","Defaulted","Cancelled"]', NULL, 0, 1, 7),
    (@plid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 8);
END
GO

-- Default fields for Fleet / Vehicles
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='fleet')
BEGIN
    DECLARE @flid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='fleet');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@flid, 'vehicle_name', 'Vehicle Name / Reg. No.', 'text', NULL, NULL, 1, 1, 1),
    (@flid, 'vehicle_type', 'Type', 'select', '["Car","Van","Truck","Ambulance","Motorcycle","Bus","Other"]', NULL, 0, 1, 2),
    (@flid, 'assigned_branch', 'Assigned Branch', 'text', NULL, NULL, 0, 1, 3),
    (@flid, 'driver_name', 'Driver Name', 'text', NULL, NULL, 0, 1, 4),
    (@flid, 'registration_expiry', 'Registration Expiry', 'date', NULL, NULL, 0, 1, 5),
    (@flid, 'insurance_expiry', 'Insurance Expiry', 'date', NULL, NULL, 0, 1, 6),
    (@flid, 'last_service_date', 'Last Service Date', 'date', NULL, NULL, 0, 1, 7),
    (@flid, 'condition', 'Condition', 'select', '["Good","Needs Maintenance","Under Repair","Out of Service"]', NULL, 0, 1, 8),
    (@flid, 'status', 'Status', 'select', '["Active","In Use","Under Maintenance","Decommissioned"]', NULL, 0, 1, 9),
    (@flid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Vendors / Procurement
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='vendors')
BEGIN
    DECLARE @vnid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='vendors');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@vnid, 'vendor_name', 'Vendor / Supplier Name', 'text', NULL, NULL, 1, 1, 1),
    (@vnid, 'category', 'Category', 'select', '["Office Supplies","Construction","Food Supplies","Medical Supplies","IT Equipment","Transport","Services","Other"]', NULL, 0, 1, 2),
    (@vnid, 'contact_person', 'Contact Person', 'text', NULL, NULL, 0, 1, 3),
    (@vnid, 'phone', 'Phone', 'phone', NULL, NULL, 0, 1, 4),
    (@vnid, 'email', 'Email', 'email', NULL, NULL, 0, 1, 5),
    (@vnid, 'po_reference', 'Latest PO Reference', 'text', NULL, NULL, 0, 1, 6),
    (@vnid, 'po_amount', 'PO Amount', 'currency', NULL, '{"prefix":"Rs.","decimals":0,"min":0}', 0, 1, 7),
    (@vnid, 'rating', 'Vendor Rating', 'select', '["Excellent","Good","Average","Poor","Blacklisted"]', NULL, 0, 1, 8),
    (@vnid, 'status', 'Status', 'select', '["Active","Under Review","Inactive","Blacklisted"]', NULL, 0, 1, 9),
    (@vnid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 10);
END
GO

-- Default fields for Meetings / Minutes (Board, staff, coordination meetings)
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='meetings')
BEGIN
    DECLARE @mtid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='meetings');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@mtid, 'meeting_title', 'Meeting Title', 'text', NULL, NULL, 1, 1, 1),
    (@mtid, 'meeting_type', 'Type', 'select', '["Board Meeting","Staff Meeting","Donor Meeting","Coordination Meeting","AGM","Other"]', NULL, 0, 1, 2),
    (@mtid, 'meeting_date', 'Date', 'date', NULL, NULL, 0, 1, 3),
    (@mtid, 'location', 'Location', 'text', NULL, NULL, 0, 1, 4),
    (@mtid, 'attendees', 'Attendees', 'textarea', NULL, NULL, 0, 1, 5),
    (@mtid, 'agenda', 'Agenda', 'textarea', NULL, NULL, 0, 1, 6),
    (@mtid, 'minutes', 'Minutes / Decisions', 'textarea', NULL, NULL, 0, 1, 7),
    (@mtid, 'action_items', 'Action Items', 'textarea', NULL, NULL, 0, 1, 8),
    (@mtid, 'status', 'Status', 'select', '["Scheduled","Completed","Cancelled"]', NULL, 0, 1, 9);
END
GO

-- Default fields for Legal / Compliance Docs (registration, tax exemption, licenses)
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='compliance')
BEGIN
    DECLARE @cpid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='compliance');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@cpid, 'document_name', 'Document Name', 'text', NULL, '{"helpText":"e.g. Registration Certificate, Tax Exemption, NOC"}', 1, 1, 1),
    (@cpid, 'document_type', 'Type', 'select', '["Registration Certificate","Tax Exemption","NOC","License","Audit Report","Policy","Other"]', NULL, 0, 1, 2),
    (@cpid, 'issuing_authority', 'Issuing Authority', 'text', NULL, NULL, 0, 1, 3),
    (@cpid, 'reference_number', 'Reference / Certificate Number', 'text', NULL, NULL, 0, 1, 4),
    (@cpid, 'issue_date', 'Issue Date', 'date', NULL, NULL, 0, 1, 5),
    (@cpid, 'expiry_date', 'Expiry / Renewal Date', 'date', NULL, NULL, 0, 1, 6),
    (@cpid, 'status', 'Status', 'select', '["Valid","Expiring Soon","Expired","Renewal In Progress"]', NULL, 0, 1, 7),
    (@cpid, 'notes', 'Notes', 'textarea', NULL, NULL, 0, 1, 8);
END
GO

-- Default fields for Surveys / Needs Assessment
IF NOT EXISTS (SELECT 1 FROM dbo.ModuleFields mf JOIN dbo.Modules m ON m.ModuleId=mf.ModuleId WHERE m.ModuleKey='surveys')
BEGIN
    DECLARE @svid INT = (SELECT ModuleId FROM dbo.Modules WHERE ModuleKey='surveys');
    INSERT INTO dbo.ModuleFields (ModuleId, FieldKey, Label, FieldType, Options, Config, IsRequired, IsDefault, SortOrder) VALUES
    (@svid, 'survey_title', 'Survey / Assessment Title', 'text', NULL, NULL, 1, 1, 1),
    (@svid, 'survey_type', 'Type', 'select', '["Needs Assessment","Baseline Survey","Endline Survey","Satisfaction Survey","Rapid Assessment"]', NULL, 0, 1, 2),
    (@svid, 'location', 'Location Covered', 'text', NULL, NULL, 0, 1, 3),
    (@svid, 'conducted_by', 'Conducted By', 'text', NULL, NULL, 0, 1, 4),
    (@svid, 'start_date', 'Start Date', 'date', NULL, NULL, 0, 1, 5),
    (@svid, 'end_date', 'End Date', 'date', NULL, NULL, 0, 1, 6),
    (@svid, 'sample_size', 'Sample Size', 'number', NULL, '{"min":0}', 0, 1, 7),
    (@svid, 'key_findings', 'Key Findings', 'textarea', NULL, NULL, 0, 1, 8),
    (@svid, 'status', 'Status', 'select', '["Planned","In Progress","Completed","Report Published"]', NULL, 0, 1, 9);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE SettingKey='site_name')
    INSERT INTO dbo.Settings (SettingKey, SettingValue) VALUES ('site_name','Vertox CRM');
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE SettingKey='theme_color')
    INSERT INTO dbo.Settings (SettingKey, SettingValue) VALUES ('theme_color','blue');
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE SettingKey='currency_code')
    INSERT INTO dbo.Settings (SettingKey, SettingValue) VALUES ('currency_code','USD');
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE SettingKey='currency_locale')
    INSERT INTO dbo.Settings (SettingKey, SettingValue) VALUES ('currency_locale','en-US');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_AuditLogs_CreatedAt' AND object_id=OBJECT_ID('dbo.AuditLogs'))
    CREATE INDEX IX_AuditLogs_CreatedAt ON dbo.AuditLogs(CreatedAt DESC);
GO

-- Base currency: seeded from whatever currency_code Settings already has
-- (defaults to USD on a fresh install), rate 1-to-1 against itself. NGOs
-- can add EUR/PKR/etc from the Ledger > Currencies screen and set each
-- one's rate against this base.
IF NOT EXISTS (SELECT 1 FROM dbo.Currencies WHERE IsBase = 1)
BEGIN
    DECLARE @baseCode NVARCHAR(3) = COALESCE((SELECT SettingValue FROM dbo.Settings WHERE SettingKey='currency_code'), 'USD');
    IF NOT EXISTS (SELECT 1 FROM dbo.Currencies WHERE CurrencyCode = @baseCode)
        INSERT INTO dbo.Currencies (CurrencyCode, CurrencyName, Symbol, ExchangeRateToBase, IsBase) VALUES (@baseCode, @baseCode + ' (Base Currency)', NULL, 1, 1);
    ELSE
        UPDATE dbo.Currencies SET IsBase = 1, ExchangeRateToBase = 1 WHERE CurrencyCode = @baseCode;
END
GO

PRINT 'Vertox CRM database schema + seed data created successfully.';
