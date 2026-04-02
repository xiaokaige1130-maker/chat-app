# Chat App

一个面向小团队使用的轻量聊天应用，当前版本已支持：

- 用户注册和登录
- 联系人搜索与添加
- 单聊实时消息
- Web 部署
- Windows EXE 打包

项目结构：

- `backend/`: Express + Socket.IO 后端
- `frontend/`: React + Vite 前端
- `electron/`: 桌面端壳
- `dev.sh`: 开发模式启动脚本
- `start.sh`: 生产模式启动脚本

## 本地开发

```bash
./dev.sh
```

默认端口：

- 前端开发服务：`5173`
- 后端 API：`3001`

## Windows EXE

先在 Windows 项目根目录执行：

```bash
npm install
```

开发模式：

```bash
npm run desktop:dev
```

打包 Windows 安装包：

```bash
npm run desktop:build
```

打包完成后，安装包会输出到：

```text
release/
```

桌面版运行方式：

- Electron 启动时会拉起本地后端
- 后端继续提供 API、Socket 和静态页面
- 桌面窗口直接加载 `http://127.0.0.1:3001`

## Ubuntu 24.04 部署

建议环境：

- Node.js 20+
- npm 10+

### 1. 安装 Node.js

```bash
sudo apt update
sudo apt install -y curl
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

```bash
chmod +x start.sh dev.sh
JWT_SECRET='换成你自己的强密码' PORT=3001 HOST=127.0.0.1 ./start.sh
```

说明：

- `start.sh` 会自动安装依赖
- 自动构建 `frontend/dist`
- 由后端在 `3001` 端口统一提供站点

### 4. 使用 PM2 守护

先安装：

```bash
sudo npm install -g pm2
```

再启动：

```bash
cd /path/to/chat-app
JWT_SECRET='换成你自己的强密码' PORT=3001 HOST=127.0.0.1 pm2 start ./start.sh --name chat-app --interpreter bash
pm2 save
pm2 startup
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

生产部署后，直接访问你的域名即可。当前前端、API 和 WebSocket 都走同一站点，不需要单独再开放 `5173`。
