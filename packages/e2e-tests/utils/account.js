const { BN } = require("bn.js");
const {
    utils: {
        format: { parseNearAmount },
        KeyPairEd25519,
    },
} = require("near-api-js");
const BN = require("bn.js");

const { fetchLinkdropContract } = require("../contracts");
const nearApiJsConnection = require("./connectionSingleton");
const { getKeyPairFromSeedPhrase } = require("./helpers");

class E2eTestAccount {
    constructor(accountId, seedPhrase, parentNearApiJsAccount) {
        this.accountId = accountId;
        this.seedPhrase = seedPhrase;
        this.parentNearApiJsAccount = parentNearApiJsAccount;
    }
    async initialize() {
        await nearApiJsConnection.setKeyPairFromSeedPhrase(this);
        await this.connectToNearApiJs();
        return this;
    }
    async connectToNearApiJs() {
        const near = await nearApiJsConnection.getConnection();
        this.nearApiJsAccount = await near.account(this.accountId);
    }
    async create({ amount, contractWasm } = { amount: "1.0" }) {
        if (contractWasm) {
            await this.parentNearApiJsAccount.createAndDeployContract(
                this.accountId,
                getKeyPairFromSeedPhrase(this.seedPhrase).publicKey,
                contractWasm,
                parseNearAmount(amount)
            );
        } else {
            await this.parentNearApiJsAccount.createAccount(
                this.accountId,
                getKeyPairFromSeedPhrase(this.seedPhrase).publicKey,
                parseNearAmount(amount)
            );
        }
        this.isCreated = true;
        return this.initialize();
    }
    spawnRandomSubAccountInstance() {
        if (!this.nearApiJsAccount) {
            throw new Error("Account needs to be initialized to spawn sub accounts");
        }
        const randomSubaccountId = generateTestAccountId();
        const randomSubaccountSeedphrase = `${randomSubaccountId} ${process.env.TEST_ACCOUNT_SEED_PHRASE}`;
        return new E2eTestAccount(randomSubaccountId, randomSubaccountSeedphrase, this.nearApiJsAccount);
    }
    async delete() {
        if (this.isCreated) {
            // this will not allow deletion of existing accounts connected to from here, only created accounts
            await this.nearApiJsAccount.deleteAccount(this.parentNearApiJsAccount.accountId);
        }
    }
    async getUpdatedBalance() {
        await this.connectToNearApiJs();
        return this.nearApiJsAccount.getAccountBalance();
    }
    async getAmountStakedWithValidator(validatorAccountId) {
        const balanceString = await this.nearApiJsAccount.viewFunction(validatorAccountId, "get_account_staked_balance", {
            account_id: this.accountId,
        });
        return new BN(balanceString);
    }
}

function generateTestAccountId() {
    return `test-playwright-account-${Date.now()}-${Math.floor(Math.random() * 1000) % 1000}`;
}

const getBankAccount = async () => {
    const { BANK_ACCOUNT: accountId, BANK_SEED_PHRASE: seedPhrase } = process.env;
    const account = new E2eTestAccount(accountId, seedPhrase, { accountId: nearApiJsConnection.config.networkId });
    return account.initialize();
};

class LinkdropAccountManager {
    // Create random accounts for linkdrop sender, receiver and contract account and deploy linkdrop contract to the contract account
    // The random accounts are created as subaccounts of BANK_ACCOUNT
    constructor(bankAccount) {
        this.linkdropSenderAccount = bankAccount.spawnRandomSubAccountInstance();
        this.linkdropContractAccount = bankAccount.spawnRandomSubAccountInstance();
        this.linkdropReceiverAccount = bankAccount.spawnRandomSubAccountInstance();
    }
    async initialize(senderNearBalance) {
        await Promise.all([
            this.linkdropSenderAccount.create({ amount: senderNearBalance }),
            fetchLinkdropContract().then((contractWasm) => this.linkdropContractAccount.create({ amount: "5.0", contractWasm })),
            this.linkdropReceiverAccount.create(),
        ]);
        return this;
    }
    async send(nearAmount) {
        const { publicKey, secretKey } = KeyPairEd25519.fromRandom();
        await this.linkdropSenderAccount.nearApiJsAccount.functionCall(
            this.linkdropContractAccount.accountId,
            "send",
            { public_key: publicKey.toString() },
            null,
            new BN(parseNearAmount(nearAmount))
        );
        this.lastSecretKey = secretKey;
        return secretKey;
    }
    async sendToNetworkTLA(nearAmount) {
        const { publicKey, secretKey } = KeyPairEd25519.fromRandom();
        await this.linkdropSenderAccount.nearApiJsAccount.functionCall(
            nearApiJsConnection.config.networkId,
            "send",
            { public_key: publicKey.toString() },
            null,
            new BN(parseNearAmount(nearAmount))
        );
        return secretKey;
    }
    deleteAccounts() {
        return Promise.allSettled([
            this.linkdropSenderAccount.delete(),
            this.linkdropContractAccount.delete(),
            this.linkdropReceiverAccount.delete(),
        ]);
    }
}

module.exports = {
    getBankAccount,
    generateTestAccountId,
    E2eTestAccount,
    LinkdropAccountManager,
};
