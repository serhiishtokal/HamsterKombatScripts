// ==UserScript==
// @name         HamsterKombatGame Auto Buyer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automate purchases in HamsterKombatGame with style!
// @match        *hamsterkombatgame.io/clicker*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=hamsterkombatgame.io
// @grant        none
// @author       serhiishtokal
// @downloadURL  https://github.com/serhiishtokal/HamsterKombatScripts/raw/main/auto-buyer.js
// @updateURL    https://github.com/serhiishtokal/HamsterKombatScripts/raw/main/auto-buyer.js
// @homepage     https://github.com/serhiishtokal/HamsterKombatScripts
// ==/UserScript==

(function () {
    'use strict';

    // Default configuration
    const config = {
        balanceLimit: 10000,
        minDelay: 2500,
        maxDelay: 4000,
    };
    
    class HamsterAPI {
        constructor(authToken) {
            this.baseUrl = "https://api.hamsterkombatgame.io/clicker";
            this.authToken = authToken;
        }

        async request(url, method, body = null) {
            const headers = {
                "accept": "application/json",
                "authorization": `Bearer ${this.authToken}`,
                "content-type": "application/json",
                "cache-control": "no-cache",
                "pragma": "no-cache",
                "x-requested-with": "org.telegram.messenger.web",
            };
            try {
                const response = await fetch(this.baseUrl + url, {
                    headers,
                    method,
                    body: body ? JSON.stringify(body) : null,
                    mode: "cors",
                    referrer: "https://hamsterkombatgame.io/",
                    referrerPolicy: "strict-origin-when-cross-origin",
                });
                const jsonResponse = await response.json();
                if (!response.ok) {
                    throw new Error(jsonResponse.error || 'Unknown error');
                }
                return jsonResponse;
            } catch (error) {
                console.error(`Error in request to ${url}:`, error);
                throw error;
            }
        }

        sync() {
            return this.request("/sync", "POST");
        }

        getUpgradesForBuy() {
            return this.request("/upgrades-for-buy", "POST");
        }

        buyUpgrade(upgradeId, timestamp) {
            const body = {upgradeId, timestamp};
            return this.request("/buy-upgrade", "POST", body);
        }
    }

    class Clicker {
        constructor(api, config, ui) {
            this.api = api;
            this.config = config;
            this.ui = ui;
            this.isRunning = false;
            this.balance = 0;
            this.upgradesForBuy = [];
            this.consecutiveErrors = 0;
        }

        async start() {
            this.isRunning = true;
            this.consecutiveErrors = 0;
            this.ui.updateStartStopButton(this.isRunning);
            try {
                const syncResponse = await this.api.sync();
                this.balance = syncResponse.clickerUser.balanceCoins;
                this.ui.updateBalanceDisplay(this.balance);
                this.upgradesForBuy = (await this.api.getUpgradesForBuy()).upgradesForBuy;
                this.ui.showNotification(`Starting purchases. Current Balance: ${this.formatNumber(this.balance)} coins`);
                this.loop();
            } catch (error) {
                this.ui.showNotification("Error starting the clicker.", 'error');
                console.error("Error during start:", error);
                this.isRunning = false;
                this.ui.updateStartStopButton(this.isRunning);
            }
        }

        stop() {
            this.isRunning = false;
            this.ui.updateStartStopButton(this.isRunning);
            this.ui.showNotification("Clicker stopped.");
        }

        async loop() {
            while (this.isRunning && this.balance > this.config.balanceLimit) {
                const affordableUpgrades = this.getAffordableUpgrades();
                if (!affordableUpgrades.length) {
                    this.ui.showNotification("No affordable and available upgrades.", 'error');
                    break;
                }

                const upgrade = affordableUpgrades[0];
                this.ui.showNotification(`Attempting to purchase ${upgrade.name}`);
                try {
                    const timestamp = Date.now();
                    const purchaseResponse = await this.api.buyUpgrade(upgrade.id, timestamp);
                    if (purchaseResponse?.clickerUser) {
                        this.balance = purchaseResponse.clickerUser.balanceCoins;
                        this.ui.updateBalanceDisplay(this.balance);
                        this.ui.showNotification(`Bought: ${upgrade.name}, New Balance: ${this.formatNumber(this.balance)} coins`);
                        this.consecutiveErrors = 0;
                        this.upgradesForBuy = purchaseResponse.upgradesForBuy;
                    } else {
                        throw new Error(purchaseResponse?.error || 'Unknown error');
                    }
                } catch (error) {
                    this.consecutiveErrors++;
                    this.ui.showNotification(`Failed to purchase ${upgrade.name}: ${error.message}`, 'error');
                    if (this.consecutiveErrors >= 3) {
                        this.ui.showNotification(`Stopped purchasing after ${this.consecutiveErrors} consecutive errors.`, 'error');
                        this.stop();
                        break;
                    }
                    this.upgradesForBuy = this.upgradesForBuy.filter(u => u.id !== upgrade.id);
                    continue;
                }

                const delay = this.getRandomDelay();
                await this.sleep(delay);
            }
            if (this.isRunning) {
                this.ui.showNotification("Balance limit reached or no more upgrades available.");
                this.stop();
            }
        }

        getAffordableUpgrades() {
            const now = Date.now();
            return this.upgradesForBuy
                .filter(upgrade => upgrade.price <= this.balance)
                .filter(upgrade => this.isUpgradeAvailable(upgrade, now))
                .sort((a, b) => (b.profitPerHourDelta / b.price) - (a.profitPerHourDelta / a.price));
        }

        isUpgradeAvailable(upgrade, now) {
            if (upgrade.isAvailable === false || upgrade.isExpired === true) return false;
            const enableAt = new Date(upgrade.enableAt || 0).getTime();
            const expiresAt = new Date(upgrade.expiresAt || Infinity).getTime();
            if (now < enableAt || now > expiresAt) return false;
            if (upgrade.cooldownSeconds && upgrade.cooldownSeconds > 0) return false;
            return true;
        }

        getRandomDelay() {
            const {minDelay, maxDelay} = this.config;
            return Math.random() * (maxDelay - minDelay) + minDelay;
        }

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        formatNumber(num) {
            if (num >= 1e6) {
                return (num / 1e6).toFixed(2) + 'M';
            } else if (num >= 1e3) {
                return (num / 1e3).toFixed(2) + 'K';
            } else {
                return num.toString();
            }
        }
    }

    class UI {
        constructor(config) {
            this.config = config;
            this.createStyles();
            this.clicker = null;
            this.popup = null;
            this.notificationContainer = null;
        }

        createStyles() {
            const style = document.createElement('style');
            style.innerHTML = `
                .retro-popup {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 400px;
                    background: rgba(75, 0, 130, 0.9);
                    border: 2px solid #9400D3;
                    border-radius: 10px;
                    padding: 10px;
                    z-index: 10000;
                    font-family: 'Courier New', Courier, monospace;
                    color: #FFFFFF;
                    box-shadow: 0 0 10px #9400D3;
                }
                .retro-popup h2 {
                    margin-top: 0;
                    text-align: center;
                    color: #DA70D6;
                }
                .retro-popup label {
                    display: block;
                    margin-bottom: 5px;
                }
                .retro-popup input {
                    width: 100%;
                    padding: 5px;
                    margin-bottom: 15px;
                    border: 1px solid #9400D3;
                    border-radius: 5px;
                    background: rgba(0, 0, 0, 0.5);
                    color: #FFFFFF;
                }
                
                #startStopBtn {
                    width: 100%;
                    padding: 10px;
                    font-size: 16px;
                }
                
                .retro-popup button {
                    background: #8A2BE2;
                    border: none;
                    border-radius: 5px;
                    color: #FFFFFF;
                    cursor: pointer;
                }
                .retro-popup .close-btn {
                    background: none;
                    border: none;
                    font-size: 28px; /* Larger size for visibility */
                    color: #FFFFFF;
                    cursor: pointer;
                }
                
                .popup-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .close-btn {
                    font-size: 24px;
                    background: none;
                    border: none;
                    color: #FFFFFF;
                    cursor: pointer;
                }
                
                .retro-notification-container {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 9999;
                    pointer-events: none;
                }
                .retro-notification {
                    background: rgba(75, 0, 130, 0.7);
                    padding: 10px 20px;
                    margin-bottom: 10px;
                    border-radius: 5px;
                    color: #FFFFFF;
                    font-family: 'Courier New', Courier, monospace;
                    border: 1px solid #9400D3;
                    box-shadow: 0 0 10px #9400D3;
                    pointer-events: auto;
                }
            `;
            document.head.appendChild(style);
        }

        createPopup() {
            this.popup = document.createElement('div');
            this.popup.className = 'retro-popup';
            this.popup.innerHTML = `
              <div class="popup-header">
                <h2>HamsterKombat Auto Buyer</h2>
                <button class="close-btn">&times;</button>
              </div>
                
            
              <div id="currentBalance">Current Balance: Loading...</div>
              <label for="balanceLimit">Balance Limit (min coins):</label>
              <input type="number" id="balanceLimit" value="${this.config.balanceLimit}">
              <label for="minDelay">Min Delay (ms):</label>
              <input type="number" id="minDelay" value="${this.config.minDelay}">
              <label for="maxDelay">Max Delay (ms):</label>
              <input type="number" id="maxDelay" value="${this.config.maxDelay}">
              <button id="startStopBtn">Start</button>
            `;

            this.balanceLimitInput = this.popup.querySelector('#balanceLimit');
            this.minDelayInput = this.popup.querySelector('#minDelay');
            this.maxDelayInput = this.popup.querySelector('#maxDelay');
            this.startStopBtn = this.popup.querySelector('#startStopBtn');
            this.closeBtn = this.popup.querySelector('.close-btn');
            this.currentBalanceDiv = this.popup.querySelector('#currentBalance');

            this.startStopBtn.addEventListener('click', () => this.toggleClicker());
            this.closeBtn.addEventListener('click', () => this.popup.remove());

            // Ensure popup is above notifications
            this.popup.style.zIndex = "10000";
        }

        async showPopup() {
            if (!this.popup) {
                this.createPopup();
            }
            document.body.appendChild(this.popup);

            // Fetch the current balance
            try {
                const authToken = localStorage.getItem("authToken");
                const api = new HamsterAPI(authToken);
                const syncResponse = await api.sync();
                const balance = syncResponse.clickerUser.balanceCoins;
                this.currentBalanceDiv.textContent = `Current Balance: ${this.formatNumber(balance)} coins`;

                // Set default balance limit to -40% of current balance
                this.balanceLimitInput.value = Math.floor(balance * 0.6);

                // Store API and balance for use in Clicker
                this.api = api;
                this.balance = balance;
            } catch (error) {
                console.error("Error fetching current balance:", error);
                this.currentBalanceDiv.textContent = "Current Balance: Error fetching balance";
            }
        }

        updateStartStopButton(isRunning) {
            this.startStopBtn.textContent = isRunning ? 'Stop' : 'Start';
        }

        showNotification(message, type = 'info') {
            if (!this.notificationContainer) {
                this.notificationContainer = document.createElement('div');
                this.notificationContainer.className = 'retro-notification-container';
                document.body.appendChild(this.notificationContainer);
            }

            const notification = document.createElement('div');
            notification.className = 'retro-notification';
            notification.textContent = message;
            if (type === 'error') {
                notification.style.borderColor = '#FF1493';
                notification.style.boxShadow = '0 0 10px #FF1493';
            }

            // Insert at the top
            this.notificationContainer.insertBefore(notification, this.notificationContainer.firstChild);

            // Remove after 1 second
            setTimeout(() => {
                notification.remove();
            }, 2000);
        }

        updateBalanceDisplay(balance) {
            this.currentBalanceDiv.textContent = `Current Balance: ${this.formatNumber(balance)} coins`;
        }

        toggleClicker() {
            if (this.clicker && this.clicker.isRunning) {
                this.clicker.stop();
            } else {
                this.updateConfig();
                const authToken = localStorage.getItem("authToken");
                const api = new HamsterAPI(authToken);
                this.clicker = new Clicker(api, this.config, this);
                this.clicker.start();
            }
        }

        updateConfig() {
            this.config.balanceLimit = parseInt(this.balanceLimitInput.value, 10) || this.config.balanceLimit;
            this.config.minDelay = parseInt(this.minDelayInput.value, 10) || this.config.minDelay;
            this.config.maxDelay = parseInt(this.maxDelayInput.value, 10) || this.config.maxDelay;
        }

        formatNumber(num) {
            if (num >= 1e6) {
                return (num / 1e6).toFixed(2) + 'M';
            } else if (num >= 1e3) {
                return (num / 1e3).toFixed(2) + 'K';
            } else {
                return num.toString();
            }
        }
    }

    // Initialize UI
    const ui = new UI(config);

    // Create and style the "Buy Upgrades" button
    const openButton = document.createElement("button");
    openButton.textContent = "Buy Upgrades";
    Object.assign(openButton.style, {
        position: "fixed",
        left: "20px",
        top: "50%",
        transform: "translateY(-50%)",
        padding: "10px 20px",
        fontSize: "16px",
        zIndex: "9998",
        backgroundColor: "#8A2BE2",
        color: "#fff",
        border: "none",
        borderRadius: "5px",
        cursor: "pointer",
        fontFamily: "'Courier New', Courier, monospace",
    });
    document.body.appendChild(openButton);

    openButton.addEventListener("click", async () => {
        await ui.showPopup();
    });

})();