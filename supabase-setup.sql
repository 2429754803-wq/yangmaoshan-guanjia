-- ============================================================
-- 羊毛衫管家 - 云端建表脚本
-- 在 Supabase 项目的 SQL Editor 里执行一次即可
-- ============================================================

-- 1) 授权码表：管理端生成的激活码
create table if not exists licenses (
  code text primary key,                -- 授权码（管理端生成）
  name text not null,                   -- 授权给谁（商家/店名）
  note text,                            -- 备注
  created_at timestamptz default now(),
  revoked_at timestamptz                -- 非空 = 已吊销
);

-- 2) 授权码激活记录：哪个账号在什么时候用某授权码激活过
create table if not exists license_activations (
  id bigint generated always as identity primary key,
  license_code text references licenses(code) on delete cascade,
  account_id text not null,             -- 手机端账号 id
  username text,                        -- 手机端用户名
  activated_at timestamptz default now()
);

-- 3) 版本表：管理端发布的新版本
create table if not exists app_versions (
  version text primary key,             -- 版本号，如 "2.1"
  url text not null,                    -- 新版本文件地址（html）
  notes text,                           -- 更新说明
  created_at timestamptz default now()
);

-- 4) 云端同步表：按用户名隔离（多手机共用同一用户名 = 同一份数据）
create table if not exists knit_sync (
  username text primary key,            -- 用户名（跨设备标识）
  data jsonb not null,                  -- 该用户全部数据
  updated_at timestamptz default now()
);

-- 5) 云端账号表：用户名全局唯一，多手机登录同一账号
create table if not exists cloud_users (
  username text primary key,            -- 用户名（全局唯一）
  salt text not null,                   -- 密码盐
  hash text not null,                   -- 密码哈希（SHA-256(username:salt)）
  created_at timestamptz default now()
);

-- ============================================================
-- 行级安全策略（重要！开放匿名读写这几个表）
-- ============================================================
alter table licenses enable row level security;
alter table license_activations enable row level security;
alter table app_versions enable row level security;
alter table knit_sync enable row level security;
alter table cloud_users enable row level security;

create policy "public read licenses" on licenses for select using (true);
create policy "public read license_activations" on license_activations for select using (true);
create policy "public insert license_activations" on license_activations for insert with check (true);
create policy "public read app_versions" on app_versions for select using (true);
create policy "public read knit_sync" on knit_sync for select using (true);
create policy "public write knit_sync" on knit_sync for all using (true) with check (true);
create policy "public read cloud_users" on cloud_users for select using (true);
create policy "public insert cloud_users" on cloud_users for insert with check (true);

-- 注意：licenses 的 insert/update 仅由电脑管理后台操作。
-- 管理后台使用服务端密钥（service_role key），不受 RLS 限制，无需额外策略。
-- 手机端只能 select（验证授权码是否存在/未吊销），不能增删改。
