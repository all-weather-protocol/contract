import axios from "axios";
import { usePoller } from "eth-hooks";
import { useState } from "react";

export default function useRebalanceSuggestions(addresses, pollTime = 39999) {
  const [rebalanceSuggestions, setRebalanceSuggestions] = useState([]);
  const [totalInterest, setTotalInterest] = useState(0);
  const [portfolioApr, setPortfolioApr] = useState(0);
  const [sharpeRatio, setSharpeRatio] = useState(0);
  const [topNPoolConsistOfSameLpToken, setTopNPoolConsistOfSameLpToken] = useState([]);
  const [topNStableCoins, setTopNStableCoins] = useState([]);
  const loadSuggestions = async () => {
    axios
      .get(`http://0.0.0.0:3001/?addresses=${addresses.addresses.join("+")}`)
      .then(response => {
        const newRebalanceSuggestions = response.data.suggestions;
        setRebalanceSuggestions(newRebalanceSuggestions);
        const totalInterest = response.data.total_interest;
        setTotalInterest(totalInterest);
        const portfolioApr = response.data.portfolio_apr;
        setPortfolioApr(portfolioApr);
        const sharpeRatio = response.data.sharpe_ratio;
        setSharpeRatio(sharpeRatio);
        const topNPoolConsistOfSameLpToken = response.data.top_n_pool_consist_of_same_lp_token;
        setTopNPoolConsistOfSameLpToken(topNPoolConsistOfSameLpToken);
        const topNStableCoins = response.data.topn_stable_coins;
        setTopNStableCoins(topNStableCoins);
      })
      .catch(error => console.log(error));
  };

  usePoller(loadSuggestions, pollTime);
  return {
    rebalanceSuggestions,
    totalInterest,
    portfolioApr,
    sharpeRatio,
    topNPoolConsistOfSameLpToken,
    topNStableCoins,
  };
}
