-- 驿见认证数据的 MySQL 结构。
-- 请先在目标 MySQL 数据库中选择数据库，再执行本文件。
-- 所有时间按 UTC 写入；应用层通过 MYSQL_URL 连接。

CREATE TABLE IF NOT EXISTS yijian_users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  password_hash VARCHAR(255) NULL,
  email_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  password_set_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY yijian_users_email_uq (email),
  KEY yijian_users_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS yijian_otp_challenges (
  email VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  purpose VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sent_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at DATETIME(3) NOT NULL,
  sent_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  used_at DATETIME(3) NULL,
  PRIMARY KEY (email, purpose),
  KEY yijian_otp_expiry_idx (expires_at),
  CONSTRAINT yijian_otp_purpose_ck CHECK (purpose IN ('login', 'register')),
  CONSTRAINT yijian_otp_attempts_ck CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT yijian_otp_sent_count_ck CHECK (sent_count BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS yijian_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY yijian_sessions_expiry_idx (expires_at),
  KEY yijian_sessions_user_idx (user_id),
  CONSTRAINT yijian_sessions_user_fk
    FOREIGN KEY (user_id) REFERENCES yijian_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS yijian_parcels (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tracking_no VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  carrier_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  carrier_name VARCHAR(128) NULL,
  status VARCHAR(16) NOT NULL DEFAULT '运输中',
  status_detail VARCHAR(512) NULL,
  location VARCHAR(255) NULL,
  pickup_code VARCHAR(128) NULL,
  pickup_location VARCHAR(255) NULL,
  eta VARCHAR(128) NULL,
  -- 查询时用过的收寄件人电话（中通/顺丰在快递100 为必填）。仅用于同单号复填，不对外展示。
  query_phone VARCHAR(32) NULL,
  last_synced_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY yijian_parcels_tracking_uq (user_id, tracking_no, carrier_code),
  KEY yijian_parcels_user_synced_idx (user_id, last_synced_at),
  CONSTRAINT yijian_parcels_user_fk
    FOREIGN KEY (user_id) REFERENCES yijian_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS yijian_parcel_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parcel_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_at DATETIME(3) NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(255) NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY yijian_parcel_events_key_uq (parcel_id, event_key),
  KEY yijian_parcel_events_parcel_time_idx (parcel_id, event_at),
  CONSTRAINT yijian_parcel_events_parcel_fk
    FOREIGN KEY (parcel_id) REFERENCES yijian_parcels(id) ON DELETE CASCADE,
  CONSTRAINT yijian_parcel_events_latitude_ck
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT yijian_parcel_events_longitude_ck
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
