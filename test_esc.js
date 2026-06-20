const camp = { id: '123', status: 'ACTIVE' };
// Simulate the template literal evaluation
let html = `
  header.innerHTML = '<button onclick="toggleStatus(\\\'' + camp.id + '\\\', \\\'' + camp.status + '\\\')">Click</button>';
`;
console.log("Evaluated HTML string (what the browser sees):");
console.log(html);

// Now simulate the browser's JS engine executing that line
let innerHTML_val;
const header = {
  set innerHTML(val) {
    innerHTML_val = val;
  }
};
// Execute the evaluated string
eval(html);
console.log("\nValue passed to innerHTML:");
console.log(innerHTML_val);
