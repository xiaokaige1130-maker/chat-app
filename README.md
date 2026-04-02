# Chat App

一个类似微信的简易聊天应用：

- `backend/`: Express + Socket.IO + SQLite
- `frontend/`: React + Vite

现在这个项目已经整理成两种运行方式：

- `dev.sh`: 开发模式
- `start.sh`: 生产模式，前端会先构建，再由后端统一提供页面、API 和 WebSocket

## 本地开发

```bash
./dev.sh
```

默认端口：

- 前端开发服务：`5173`
- 后端 API：`3001`

## Windows EXE

现在项目已经补了一个 Electron 桌面壳，可以打包成 Windows `exe`。

先在 Windows 机器项目根目录执行：

```bash
npm install
```

开发方式：

```bash
npm run desktop:dev
```

打包 Windows 安装包：

```bash
npm run desktop:build
```

打包完成后，产物会在：

```text
release/
```

桌面版逻辑：

- Electron 启动时会拉起本地后端
- 后端继续提供 API、Socket 和静态页面
- 桌面窗口直接加载 `http://127.0.0.1:3001`

## Ubuntu 24.04 生产部署

建议环境：

- Node.js 20+
- npm 10+
- Nginx

### 1. 安装 Node.js

```bash
sudo apt update
sudo apt install -y curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 拉取代码

```bash
git clone https://github.com/xiaokaige1130-maker/chat-app.git
cd chat-app
git checkout 260402-chore-init-chat-app
```

### 3. 启动生产服务

首次可以直接这样跑：

```bash
JWT_SECRET='换成你自己的强密码' PORT=3001 HOST=127.0.0.1 ./start.sh
```

说明：

- `start.sh` 会安装依赖
- 自动构建 `frontend/dist`
- 由 `backend` 在 `3001` 端口统一提供站点

### 4. 用 PM2 守护

先安装：

```bash
sudo npm install -g pm2
```

启动：

```bash
cd /path/to/chat-app
pm2 start ./start.sh --name chat-app --interpreter bash --update-env --env production
pm2 save
pm2 startup
```

如果你要带环境变量，推荐这样：

```bash
cd /path/to/chat-app
JWT_SECRET='换成你自己的强密码' PORT=3001 HOST=127.0.0.1 pm2 start ./start.sh --name chat-app --interpreter bash
pm2 save
```

### 5. Nginx 反向代理

新建配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/chat-app /etc/nginx/sites-enabled/chat-app
sudo nginx -t
sudo systemctl reload nginx
```

### 6. HTTPS

如果你要正式对外，建议再上证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 环境变量

后端支持：

- `PORT`: 默认 `3001`
- `HOST`: 默认 `0.0.0.0`
- `JWT_SECRET`: JWT 密钥
- `DATA_PATH`: 本地 JSON 数据文件路径，默认 `backend/data.json`

示例：

```bash
JWT_SECRET='replace-this' PORT=3001 HOST=127.0.0.1 DATA_PATH=/var/lib/chat-app/data.json ./start.sh
```

## 访问方式

生产部署后直接访问你的域名即可，前端、API 和 WebSocket 都走同一个站点，不需要额外开放 `5173`。
