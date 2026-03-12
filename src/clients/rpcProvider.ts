import { JsonRpcProvider } from "@ethersproject/providers";

export function getRpcUrl(chainId: number): string {
    const rpcToken = process.env.RPC_TOKEN;

    if (chainId === 137) {
        if (rpcToken) {
            return `https://polygon-mainnet.g.alchemy.com/v2/${rpcToken}`;
        }
        return "https://polygon-rpc.com";
    }
    if (chainId === 80002) {
        if (rpcToken) {
            return `https://polygon-amoy.g.alchemy.com/v2/${rpcToken}`;
        }
        return "https://rpc-amoy.polygon.technology";
    }

    throw new Error(`Unsupported chain ID: ${chainId}. Supported: 137 (Polygon), 80002 (Amoy)`);
}

export function getRpcProvider(chainId: number): JsonRpcProvider {
    return new JsonRpcProvider(getRpcUrl(chainId));
}
