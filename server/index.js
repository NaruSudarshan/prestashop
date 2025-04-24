const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const TENANTS_DIR = process.env.TENANTS_DIR || 'tenants';

fs.mkdirSync(TENANTS_DIR, { recursive: true });
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'static')));

function getNextPort(base = 9000) {
  let port = base;
  while (true) {
    try {
      execSync(`lsof -i:${port}`);
      port++;
    } catch {
      return port;
    }
  }
}

app.post('/create-store', async (req, res) => {
  const { email, password } = req.body;
  const existing = fs.readdirSync(TENANTS_DIR);
  const tenant = `tenant${existing.length + 1}`;
  const tenantPath = path.join(TENANTS_DIR, tenant);
  fs.mkdirSync(tenantPath, { recursive: true });
  const port = getNextPort();
  let adminFolder = 'admin';

  const compose = `
version: '3.9'
services:
  db:
    image: mysql:5.7
    container_name: ${tenant}_db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: prestashop
      MYSQL_USER: psuser
      MYSQL_PASSWORD: pspassword
    volumes:
      - db_data_${tenant}:/var/lib/mysql
    networks:
      - ps-net

  prestashop:
    image: prestashop/prestashop:8-apache
    container_name: ${tenant}_shop
    restart: always
    depends_on:
      - db
    environment:
      DB_SERVER: db
      DB_USER: psuser
      DB_PASSWD: pspassword
      PS_INSTALL_AUTO: '1'
      PS_HOST_MODE: '1'
      PS_ENABLE_SSL: '0'
      PS_HANDLE_DYNAMIC_DOMAIN: '0'
      PS_DOMAIN: 54.174.72.90:${port}
      PS_LANGUAGE: en
      PS_COUNTRY: US
      PS_FOLDER_ADMIN: ${adminFolder}
      ADMIN_MAIL: ${email}
      ADMIN_PASSWD: ${password}
    ports:
      - "${port}:80"
    volumes:
      - ps_data_${tenant}:/var/www/html
    networks:
      - ps-net

volumes:
  db_data_${tenant}:
  ps_data_${tenant}:

networks:
  ps-net:
    driver: bridge
  `;

  fs.writeFileSync(path.join(tenantPath, 'docker-compose.yml'), compose);

  spawn('docker-compose', ['-f', `${tenantPath}/docker-compose.yml`, 'up', '-d']);

  const containerName = `${tenant}_shop`;

  let tries = 0;
  let shopUrl = `http://54.174.72.90:${port}`;
  while (tries < 30) {
    try {
      const { data } = await axios.get(shopUrl);
      if (data.toLowerCase().includes('prestashop')) break;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 2000));
    tries++;
  }

  try {
    const output = execSync(`docker exec ${containerName} sh -c "basename $(find /var/www/html -maxdepth 1 -type d -name 'admin*' | head -n 1)"`);
    adminFolder = output.toString().trim();
  } catch (err) {
    console.error("Could not fetch admin folder. Defaulting to 'admin'.");
  }

  res.json({
    url: shopUrl,
    admin_url: `${shopUrl}/${adminFolder}`,
    admin_email: email,
    admin_password: password
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://54.174.72.90:${PORT}`);
});
