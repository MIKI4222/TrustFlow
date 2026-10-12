"use client";
import { createContext, useContext, useState, ReactNode } from "react";
import { Wallet as W } from "lucide-react";
import { connectWallet } from "@/lib/genlayer";
const Ctx = createContext<{ account: string; connect: () => Promise<void> }>({ account: "", connect: async () => {} });
export const useWallet = () => useContext(Ctx);
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState("");
  const connect = async () => { try { setAccount(await connectWallet()); } catch (e: any) { alert(e.message); } };
  return <Ctx.Provider value={{ account, connect }}>{children}</Ctx.Provider>;
}
export function WalletButton() {
  const { account, connect } = useWallet();
  return <button className="btn" onClick={connect}><W size={16} />{account ? account.slice(0, 6) + "…" + account.slice(-4) : "Connect Wallet"}</button>;
}
