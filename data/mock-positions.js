export const dashboardMock = {
    walletAddress: "0x7a9F...A32c",
    lastUpdated: "2026-09-12T10:30:00+07:00",
    positions: [
        {
            chain: "Optimism",
            positionId: 10482,
            pair: "WETH / OP",
            status: "in-range",
            tokens: [{ symbol: "WETH", amount: "1.2458", value: "$5,179.58" }, { symbol: "OP", amount: "2,914.28", value: "$4,371.42" }],
            currentValue: "$9,551.00",
            initialValue: "$8,940.00",
            profitLoss: "+$611.00 (+6.83%)",
            rewards: "82.41 VELO · $9.07",
            lastUpdated: "2 minutes ago"
        },
        {
            chain: "Celo",
            positionId: 66480,
            pair: "CELO / USDC",
            status: "out-of-range",
            tokens: [{ symbol: "CELO", amount: "4,625.70", value: "$2,775.42" }, { symbol: "USDC", amount: "5,918.60", value: "$5,918.60" }],
            currentValue: "$8,694.02",
            initialValue: "$9,280.00",
            profitLoss: "-$585.98 (-6.31%)",
            rewards: "126.55 VELO · $13.92",
            lastUpdated: "2 minutes ago"
        },
        {
            chain: "Soneium",
            positionId: 73211,
            pair: "ASTR / WETH",
            status: "in-range",
            tokens: [{ symbol: "ASTR", amount: "35,800.00", value: "$1,718.40" }, { symbol: "WETH", amount: "0.5312", value: "$2,208.27" }],
            currentValue: "$3,926.67",
            initialValue: "$3,740.00",
            profitLoss: "+$186.67 (+4.99%)",
            rewards: "48.10 ASTR · $2.31",
            lastUpdated: "3 minutes ago"
        }
    ]
};
