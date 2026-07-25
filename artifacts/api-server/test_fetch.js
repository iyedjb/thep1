async function main() {
  const url = "https://testolib.com/offer/dach?affId=blitz&c1=692&c2=121583780&c3=37283&utm_source=692&utm_medium=affiliate&c4=TESTL-DACH_692_121583780&sessionId=331e1780b2b74bbb9e5d39b32b8e718f";
  console.log("Fetching url:", url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log("Response status:", res.status);
    const text = await res.text();
    console.log("Response length:", text.length);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

main();
