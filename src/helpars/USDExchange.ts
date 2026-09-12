async function getRateToUSD(currency: string): Promise<number> {
  const response = await fetch(
    `https://open.er-api.com/v6/latest/${currency}`
  );

  const data = await response.json();

  if (data.result !== "success" || !data.rates?.USD) {
    throw new Error("Failed to fetch exchange rate");
  }

  return data.rates.USD;
}

export default getRateToUSD;
