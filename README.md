# Aurhythm — 音乐播放器

基于 Vite + React + Supabase 的音乐播放器应用。

## 项目结构

```
src/
├── main.jsx              # React 入口
├── App.jsx               # 主组件（包含 Supabase 查询）
├── index.css             # 全局样式
├── supabaseClient.js     # Supabase 客户端（环境变量握手）
└── components/
    └── SongList.jsx      # 歌曲列表组件
```

## 环境变量配置

| 变量名 | 说明 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |

**本地开发：**
1. 复制 `.env.example` 为 `.env.local`，填入真实值
2. `npm install && npm run dev`

**Vercel 部署：**
在项目 Settings → Environment Variables 中添加上述变量。

## Supabase 数据库表结构

在 Supabase SQL Editor 中执行：

```sql
CREATE TABLE songs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT '未知曲目',
  artist     TEXT    NOT NULL DEFAULT '未知艺术家',
  duration   TEXT    DEFAULT '--:--',
  color      TEXT    DEFAULT '#1a1a3e',
  cover_url  TEXT,
  src        TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许公开读取歌曲"
  ON songs FOR SELECT
  USING (true);
```

## 关键查询语句

`src/supabaseClient.js` — 环境变量握手连接数据库：
```js
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

`src/App.jsx` — 组件中调用数据：
```js
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

function App() {
  const [songs, setSongs] = useState([]);

  useEffect(() => {
    async function fetchSongs() {
      const { data, error } = await supabase.from('songs').select('*');
      if (error) {
        console.error("查询失败:", error);
      } else {
        setSongs(data);
      }
    }
    fetchSongs();
  }, []);

  // ...
}
```
