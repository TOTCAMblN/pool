CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE account (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    email_verified TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX account_email_lower_idx ON account (lower(email));

CREATE TABLE client_profile (
    account_id UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    birth_date DATE,
    phone      TEXT
);

CREATE TABLE trainer_profile (
    account_id     UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    specialization TEXT,
    bio            TEXT
);

CREATE TABLE manager_profile (
    account_id       UUID PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    permission_level TEXT NOT NULL DEFAULT 'staff'
        CHECK (permission_level IN ('staff', 'admin'))
);


CREATE TABLE service (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    description      TEXT,
    duration_minutes INT  NOT NULL CHECK (duration_minutes > 0),
    capacity         INT  NOT NULL CHECK (capacity > 0)
);

CREATE TABLE session (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES service(id),


    trainer_id UUID NOT NULL REFERENCES trainer_profile(account_id),

    start_time TIMESTAMPTZ NOT NULL,
    end_time   TIMESTAMPTZ NOT NULL,
    capacity   INT NOT NULL CHECK (capacity > 0),


    booked_count INT NOT NULL DEFAULT 0 CHECK (booked_count >= 0),

    CONSTRAINT session_time_order CHECK (end_time > start_time),
    CONSTRAINT session_capacity_not_exceeded CHECK (booked_count <= capacity)
);

CREATE INDEX session_start_idx ON session (start_time);
CREATE INDEX session_trainer_idx ON session (trainer_id, start_time);

CREATE TABLE membership_plan (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    duration_days INT NOT NULL CHECK (duration_days > 0),

    visits_count  INT CHECK (visits_count IS NULL OR visits_count > 0),
    is_active     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE membership (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES client_profile(account_id),
    plan_id     UUID NOT NULL REFERENCES membership_plan(id),
    start_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_date    TIMESTAMPTZ NOT NULL,
   
    visits_left INT CHECK (visits_left IS NULL OR visits_left >= 0),
    status      TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'frozen'))
);

CREATE INDEX membership_client_idx ON membership (client_id, status);



CREATE TABLE booking (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID NOT NULL REFERENCES client_profile(account_id),
    session_id    UUID NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES membership(id),

    
    staff_id      UUID REFERENCES manager_profile(account_id),

    status        TEXT NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked', 'cancelled', 'attended', 'no_show')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at  TIMESTAMPTZ,

  
    CONSTRAINT booking_unique_client_session UNIQUE (client_id, session_id)
);

CREATE INDEX booking_session_idx ON booking (session_id, status);
CREATE INDEX booking_client_idx ON booking (client_id, created_at DESC);

CREATE TABLE payment (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID NOT NULL REFERENCES client_profile(account_id),

    plan_id       UUID NOT NULL REFERENCES membership_plan(id),

  
    staff_id      UUID REFERENCES manager_profile(account_id),

    membership_id UUID UNIQUE REFERENCES membership(id),

    amount        NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    status        TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'cancelled')),
    method        TEXT NOT NULL DEFAULT 'transfer'
        CHECK (method IN ('transfer', 'cash', 'card')),

    reference     TEXT NOT NULL UNIQUE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at  TIMESTAMPTZ
);

CREATE INDEX payment_status_idx ON payment (status, created_at);


CREATE TABLE notification (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notification_account_idx ON notification (account_id, read_at);


CREATE TABLE user_session (
    sid    TEXT PRIMARY KEY,
    sess   JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX user_session_expire_idx ON user_session (expire);


CREATE VIEW account_roles AS
SELECT
    a.id,
    a.email,
    a.full_name,
    (cp.account_id IS NOT NULL) AS is_client,
    (tp.account_id IS NOT NULL) AS is_trainer,
    (mp.account_id IS NOT NULL) AS is_manager,
    mp.permission_level
FROM account a
LEFT JOIN client_profile  cp ON cp.account_id = a.id
LEFT JOIN trainer_profile tp ON tp.account_id = a.id
LEFT JOIN manager_profile mp ON mp.account_id = a.id;

CREATE VIEW session_details AS
SELECT
    s.id,
    s.start_time,
    s.end_time,
    s.capacity,
    s.booked_count,
    s.capacity - s.booked_count AS spots_left,
    sv.name        AS service_name,
    sv.duration_minutes,
    ta.full_name   AS trainer_name
FROM session s
JOIN service sv ON sv.id = s.service_id
JOIN trainer_profile tp ON tp.account_id = s.trainer_id
JOIN account ta ON ta.id = tp.account_id;
