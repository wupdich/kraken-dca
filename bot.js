#!/usr/bin/env node
const crypto = require("crypto");
const https = require("https");

/**
 * Kraken Multi-Crypto DCA Bot
 * Original by @codepleb, enhanced for multi-crypto support
 *
 * Donations in BTC: bc1q4et8wxhsguz8hsm46pnuvq7h68up8mlw6fhqyt
 * Donations in Lightning-BTC (Telegram): codepleb@ln.tips
 */

const main = async () => {
  const KRAKEN_API_PUBLIC_KEY = process.env.KRAKEN_API_PUBLIC_KEY; // Kraken API public key
  const KRAKEN_API_PRIVATE_KEY = process.env.KRAKEN_API_PRIVATE_KEY; // Kraken API private key
  const CURRENCY = process.env.CURRENCY || "USD"; // Choose the currency that you are depositing regularly. Check here how you currency has to be named: https://docs.kraken.com/rest/#operation/getAccountBalance
  const DATE_OF_CASH_REFILL = Number(process.env.DATE_OF_CASH_REFILL); // OPTIONAL! Day of month, where new funds get deposited regularly (ignore weekends, that will be handled automatically)
  const FIAT_CHECK_DELAY = Number(process.env.FIAT_CHECK_DELAY) || 60 * 1000; // OPTIONAL! Custom fiat check delay. This delay should not be smaller than the delay between orders.
  
  // Crypto configuration
  const BTC_ALLOCATION = Number(process.env.BTC_ALLOCATION) || 50; // Default allocation: 50%
  const ETH_ALLOCATION = Number(process.env.ETH_ALLOCATION) || 25; // Default allocation: 25%
  const SOL_ALLOCATION = Number(process.env.SOL_ALLOCATION) || 25; // Default allocation: 25%
  
  // Minimum order sizes
  const KRAKEN_BTC_ORDER_SIZE = Number(process.env.KRAKEN_BTC_ORDER_SIZE) || 0.0001; // Minimum BTC order
  const KRAKEN_ETH_ORDER_SIZE = Number(process.env.KRAKEN_ETH_ORDER_SIZE) || 0.004; // Minimum ETH order
  const KRAKEN_SOL_ORDER_SIZE = Number(process.env.KRAKEN_SOL_ORDER_SIZE) || 0.04; // Minimum SOL order
  
  // Withdrawal configuration
  const KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY || false;
  const KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY = process.env.KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY || false;
  
  const BTC_WITHDRAW_TARGET = Number(process.env.WITHDRAW_TARGET) || false;
  const ETH_WITHDRAW_TARGET = Number(process.env.ETH_WITHDRAW_TARGET) || false;
  const SOL_WITHDRAW_TARGET = Number(process.env.SOL_WITHDRAW_TARGET) || false;

  const PUBLIC_API_PATH = "/0/public/";
  const PRIVATE_API_PATH = "/0/private/";

  let cryptoPrefix = "";
  let fiatPrefix = "";
  if (CURRENCY === "USD" || CURRENCY === "EUR" || CURRENCY === "GBP") {
    cryptoPrefix = "X";
    fiatPrefix = "Z";
  }

  // Define crypto assets configuration
  const cryptoAssets = {
    BTC: {
      symbol: "XBT", // Kraken uses XBT for Bitcoin
      responseKey: "XXBT", // How it appears in balance response
      allocation: BTC_ALLOCATION,
      orderSize: KRAKEN_BTC_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_BTC_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: BTC_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      symbol_display: "₿"
    },
    ETH: {
      symbol: "ETH",
      responseKey: "XETH", // Based on Kraken's pattern
      allocation: ETH_ALLOCATION,
      orderSize: KRAKEN_ETH_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_ETH_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: ETH_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      symbol_display: "ETH"
    },
    SOL: {
      symbol: "SOL",
      responseKey: "XSOL", // Based on Kraken's pattern
      allocation: SOL_ALLOCATION,
      orderSize: KRAKEN_SOL_ORDER_SIZE,
      withdrawalAddressKey: KRAKEN_SOL_WITHDRAWAL_ADDRESS_KEY,
      withdrawTarget: SOL_WITHDRAW_TARGET,
      lastPrice: Number.NEGATIVE_INFINITY,
      dateOfNextOrder: new Date(),
      noSuccessfulBuyYet: true,
      allocatedFiat: 0,
      symbol_display: "SOL"
    }
  };

  const { log } = console;

  const withdrawalDate = new Date();
  withdrawalDate.setDate(1);
  withdrawalDate.setMonth(withdrawalDate.getMonth() + 1);

  let lastFiatBalance = Number.NEGATIVE_INFINITY;
  let dateOfEmptyFiat = new Date();
  let logQueue = [`[${new Date().toLocaleString()}]`];
  let firstRun = true;
  let interrupted = 0;
  
  let fiatAmount = undefined;

  log();
  log("|=================================================================|");
  log("|                     ---------------------------                  |");
  log("|                     |   Kraken Multi-DCA Bot   |                 |");
  log("|                     ---------------------------                  |");
  log("|                         Original by @codepleb                    |");
  log("|                                                                  |");
  log("| Donations BTC: bc1q4et8wxhsguz8hsm46pnuvq7h68up8mlw6fhqyt        |");
  log("| Donations Lightning-BTC (Telegram): codepleb@ln.tips             |");
  log("|=================================================================|");
  log();
  log("Multi-Crypto DCA activated now!");
  log("Fiat currency to be used:", CURRENCY);
  log(`Allocations: BTC: ${BTC_ALLOCATION}%, ETH: ${ETH_ALLOCATION}%, SOL: ${SOL_ALLOCATION}%`);
  log(`Minimum order sizes: BTC: ${KRAKEN_BTC_ORDER_SIZE}, ETH: ${KRAKEN_ETH_ORDER_SIZE}, SOL: ${KRAKEN_SOL_ORDER_SIZE}`);

  const runner = async () => {
    while (true) {
      try {
        let buyOrderExecuted = false;
        const balance = (await queryPrivateApi("Balance", ""))?.result;
        fiatAmount = Number(
          balance?.[CURRENCY === "AUD" ? "Z" : fiatPrefix + CURRENCY]
        );
        if (
          !balance ||
          Object.keys(balance).length === 0 ||
          (fiatAmount !== 0 && !fiatAmount)
        ) {
          printBalanceQueryFailedError();
          await timer(FIAT_CHECK_DELAY);
          continue;
        }

        // Update crypto balances from Kraken
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          asset.balance = Number(balance?.[asset.responseKey]) || 0;
        }

        logQueue.push(`Fiat: ${Number(fiatAmount).toFixed(2)} ${CURRENCY}`);
        const newFiatArrived = fiatAmount > lastFiatBalance;
        if (newFiatArrived || firstRun) {
          estimateNextFiatDepositDate(firstRun);
          lastFiatBalance = fiatAmount;
          firstRun = false;
          logQueue.push(
            `Empty fiat @ approx. ${dateOfEmptyFiat.toLocaleString()}`
          );
          
          // Calculate allocated fiat for each crypto
          for (const key in cryptoAssets) {
            const asset = cryptoAssets[key];
            asset.allocatedFiat = fiatAmount * (asset.allocation / 100);
            logQueue.push(`${key} allocation: ${asset.allocatedFiat.toFixed(2)} ${CURRENCY} (${asset.allocation}%)`);
          }
        }

        // Fetch prices for all cryptos
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          asset.lastPrice = await fetchCryptoPrice(asset);
          if (!asset.lastPrice) {
            console.error(`Failed to fetch price for ${key}!`);
            continue;
          }
          logQueue.push(`${key} Price: ${asset.lastPrice.toFixed(2)} ${CURRENCY}`);
        }

        const now = Date.now();
        // Process each crypto
        for (const key in cryptoAssets) {
          const asset = cryptoAssets[key];
          
          // Skip if price couldn't be fetched
          if (!asset.lastPrice) continue;
          
          // Check if it's time to buy
          if (asset.dateOfNextOrder < now || newFiatArrived) {
            await buyCrypto(asset);
            evaluateMillisUntilNextOrder(asset);
            buyOrderExecuted = true;
          }
          
          // Calculate and log balance
          const newCryptoAmount = asset.balance + asset.orderSize;
          const precision = String(asset.orderSize).split(".")[1]?.length || 0;
          logQueue.push(
            `Accumulated ${key}: ${newCryptoAmount.toFixed(precision)} ${asset.symbol_display}`
          );
          
          logQueue.push(
            `Next ${key} order in: ${formatTimeToHoursAndLess(
              asset.dateOfNextOrder.getTime() - Date.now()
            )} @ ${asset.dateOfNextOrder.toLocaleString().split(", ")[1]}`
          );
          
          // Check for withdrawal
          if (buyOrderExecuted && isWithdrawalDue(asset, newCryptoAmount)) {
            await withdrawCrypto(asset, newCryptoAmount);
          }
        }

        flushLogging(buyOrderExecuted);
        await timer(FIAT_CHECK_DELAY);
      } catch (e) {
        console.error("General Error. :/", e);
        await timer(FIAT_CHECK_DELAY);
      }
    }
  };

  const isWeekend = (date) => date.getDay() % 6 == 0;

  const executeGetRequest = (options) => {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (d) => {
          data += d;
        });
        res.on("end", () => {
          resolve(data);
        });
      });

      req.on("error", (error) => {
        console.error(error);
        reject(error);
      });
      req.end();
    });
  };

  const queryPublicApi = async (endPointName, inputParameters) => {
    const options = {
      hostname: "api.kraken.com",
      port: 443,
      path: `${PUBLIC_API_PATH}${endPointName}?${inputParameters || ""}`,
      method: "GET",
    };

    let data = "{}";
    try {
      data = await executeGetRequest(options);
      return JSON.parse(data);
    } catch (e) {
      console.error(`Could not make GET request to ${endPointName}`);
      return JSON.parse("{}");
    }
  };

  const executePostRequest = (
    apiPostBodyData,
    apiPath,
    endpoint,
    KRAKEN_API_PUBLIC_KEY,
    signature,
    https
  ) => {
    return new Promise((resolve, reject) => {
      const body = apiPostBodyData;
      const options = {
        hostname: "api.kraken.com",
        port: 443,
        path: `${apiPath}${endpoint}`,
        method: "POST",
        headers: {
          "API-Key": KRAKEN_API_PUBLIC_KEY,
          "API-Sign": signature,
        },
      };

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (d) => {
          data += d;
        });

        res.on("end", () => {
          resolve(data);
        });
      });

      req.on("error", (error) => {
        console.error("error happened", error);
        reject(error);
      });

      req.write(body);
      req.end();
    });
  };

  const queryPrivateApi = async (endpoint, params) => {
    const nonce = Date.now().toString();
    const apiPostBodyData = "nonce=" + nonce + "&" + params;

    const signature = createAuthenticationSignature(
      KRAKEN_API_PRIVATE_KEY,
      PRIVATE_API_PATH,
      endpoint,
      nonce,
      apiPostBodyData
    );

    let result = "{}";
    try {
      result = await executePostRequest(
        apiPostBodyData,
        PRIVATE_API_PATH,
        endpoint,
        KRAKEN_API_PUBLIC_KEY,
        signature,
        https
      );
      return JSON.parse(result);
    } catch (e) {
      console.error(`Could not make successful POST request to ${endpoint}`);
      return JSON.parse("{}");
    }
  };

  const createAuthenticationSignature = (
    apiPrivateKey,
    apiPath,
    endPointName,
    nonce,
    apiPostBodyData
  ) => {
    const apiPost = nonce + apiPostBodyData;
    const secret = Buffer.from(apiPrivateKey, "base64");
    const sha256 = crypto.createHash("sha256");
    const hash256 = sha256.update(apiPost).digest("binary");
    const hmac512 = crypto.createHmac("sha512", secret);
    const signatureString = hmac512
      .update(apiPath + endPointName + hash256, "binary")
      .digest("base64");
    return signatureString;
  };

  const fetchCryptoPrice = async (asset) => {
    return Number(
      (
        await queryPublicApi(
          "Ticker",
          `pair=${cryptoPrefix}${asset.symbol}${fiatPrefix}${CURRENCY}`
        )
      )?.result?.[`${cryptoPrefix}${asset.symbol}${fiatPrefix}${CURRENCY}`]?.p?.[0]
    );
  };

  const buyCrypto = async (asset) => {
    let buyOrderResponse;
    try {
      buyOrderResponse = await executeBuyOrder(asset);
      if (buyOrderResponse?.error?.length !== 0) {
        console.error(
          `Buy-Order response for ${asset.symbol} had invalid structure! Skipping this buy order.`
        );
      } else {
        asset.noSuccessfulBuyYet = false;
        logQueue.push(
          `Kraken: ${buyOrderResponse?.result?.descr?.order} > Success!`
        );
        logQueue.push(
          `Bought ${asset.symbol} for ~${(asset.lastPrice * asset.orderSize).toFixed(
            2
          )} ${CURRENCY}`
        );
      }
    } catch (e) {
      console.error(
        `Buy order request for ${asset.symbol} failed! Probably a temporary issue with Kraken, if you don't see this error right from the start. Skipping this one.`
      );
    }
  };

  const executeBuyOrder = async (asset) => {
    const privateEndpoint = "AddOrder";
    const privateInputParameters = `pair=${asset.symbol.toLowerCase()}${CURRENCY.toLowerCase()}&type=buy&ordertype=market&volume=${asset.orderSize}`;
    let privateResponse = "";
    privateResponse = await queryPrivateApi(
      privateEndpoint,
      privateInputParameters
    );
    return privateResponse;
  };

  const executeWithdrawal = async (asset, amount) => {
    const privateEndpoint = "Withdraw";
    const privateInputParameters = `asset=${asset.symbol}&key=${asset.withdrawalAddressKey}&amount=${amount}`;
    let privateResponse = "";
    privateResponse = await queryPrivateApi(
      privateEndpoint,
      privateInputParameters
    );
    return privateResponse;
  };

  const isWithdrawalDateDue = () => {
    if (new Date() > withdrawalDate) {
      withdrawalDate.setDate(1);
      withdrawalDate.setMonth(withdrawalDate.getMonth() + 1);
      return true;
    }
    return false;
  };

  const isWithdrawalDue = (asset, amount) =>
    (asset.withdrawalAddressKey &&
      !asset.withdrawTarget &&
      isWithdrawalDateDue()) ||
    (asset.withdrawalAddressKey &&
      asset.withdrawTarget &&
      asset.withdrawTarget <= amount);

  const printInvalidCurrencyError = () => {
    flushLogging();
    console.error(
      "Probably invalid currency symbol! If this happens at bot startup, please fix it. If you see this message after a lot of time, it might just be a failed request that will repair itself automatically."
    );
    let allFailed = true;
    for (const key in cryptoAssets) {
      if (!cryptoAssets[key].noSuccessfulBuyYet) {
        allFailed = false;
        break;
      }
    }
    if (++interrupted >= 3 && allFailed) {
      throw Error("Interrupted! Too many failed API calls.");
    }
  };

  const printInvalidBtcHoldings = () => {
    flushLogging();
    console.error(
      "Couldn't fetch crypto holdings. This is most probably a temporary issue with kraken, that will fix itself."
    );
  };

  const printBalanceQueryFailedError = () => {
    flushLogging();
    console.error(
      "Could not query the balance on your account. Either incorrect API key or key-permissions on kraken!"
    );
    let allFailed = true;
    for (const key in cryptoAssets) {
      if (!cryptoAssets[key].noSuccessfulBuyYet) {
        allFailed = false;
        break;
      }
    }
    if (++interrupted >= 3 && allFailed) {
      throw Error("Interrupted! Too many failed API calls.");
    }
  };

  const withdrawCrypto = async (asset, amount) => {
    console.log(`Attempting to withdraw ${amount} ${asset.symbol} ...`);
    const withdrawal = await executeWithdrawal(asset, amount);
    if (withdrawal?.result?.refid)
      console.log(`Withdrawal executed! Date: ${new Date().toLocaleString()}!`);
    else console.error(`Withdrawal failed! ${withdrawal?.error}`);
  };

  const estimateNextFiatDepositDate = (firstRun) => {
    dateOfEmptyFiat = new Date();

    // If 'DATE_OF_CASH_REFILL' is not set, ignore.
    if (firstRun && !isNaN(DATE_OF_CASH_REFILL)) {
      dateOfEmptyFiat.setDate(DATE_OF_CASH_REFILL);
      if (dateOfEmptyFiat.getTime() <= Date.now()) {
        dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
      }
    } else {
      dateOfEmptyFiat.setMonth(dateOfEmptyFiat.getMonth() + 1);
    }

    if (isWeekend(dateOfEmptyFiat))
      dateOfEmptyFiat.setDate(dateOfEmptyFiat.getDate() - 1);
    // If first time was SUN, previous day will be SAT, so we have to repeat the check.
    if (isWeekend(dateOfEmptyFiat))
      dateOfEmptyFiat.setDate(dateOfEmptyFiat.getDate() - 1);
  };

  const evaluateMillisUntilNextOrder = (asset) => {
    if (asset.lastPrice > 0) {
      const allocatedFiat = asset.allocatedFiat || (fiatAmount * (asset.allocation / 100));
      const valueInCrypto = allocatedFiat / asset.lastPrice;
      const approximatedAmoutOfOrdersUntilFiatRefill =
        valueInCrypto / asset.orderSize;

      if (approximatedAmoutOfOrdersUntilFiatRefill < 1) {
        console.error(
          `Cannot estimate time for next ${asset.symbol} order. Allocated Fiat: ${allocatedFiat}, Last ${asset.symbol} price: ${asset.lastPrice}`
        );
      } else {
        const now = Date.now();
        asset.dateOfNextOrder = new Date(
          (dateOfEmptyFiat.getTime() - now) /
            approximatedAmoutOfOrdersUntilFiatRefill +
            now
        );
      }
    } else {
      console.error(`Last ${asset.symbol} price was not present!`);
    }
  };

  const formatTimeToHoursAndLess = (timeInMillis) => {
    const hours = timeInMillis / 1000 / 60 / 60;
    const minutes = (timeInMillis / 1000 / 60) % 60;
    const seconds = (timeInMillis / 1000) % 60;
    return `${parseInt(hours, 10)}h ${parseInt(minutes, 10)}m ${Math.round(
      seconds
    )}s`;
  };

  const flushLogging = (printLogs) => {
    if (printLogs) log(logQueue.join(" > "));
    logQueue = [`[${new Date().toLocaleString()}]`];
  };

  const timer = (delay) =>
    new Promise((resolve) => {
      setTimeout(resolve, delay);
    });

  try {
    await runner();
  } catch (e) {
    flushLogging();
    console.error("Unhandled error happened. :(");
    throw e;
  }
};

main();
