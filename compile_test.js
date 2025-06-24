const solc = require('solc');
const fs = require('fs');

// Read the contract source
const source = fs.readFileSync('test_compile.sol', 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'TimeCapsule.sol': {
      content: source
    }
  },
  settings: {
    outputSelection: {
      '*': {
        '*': ['*']
      }
    },
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
};

console.log('🔨 Compiling contract...');

try {
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  if (output.errors) {
    console.log('⚠️  Compilation warnings/errors:');
    output.errors.forEach(error => {
      if (error.severity === 'error') {
        console.log('❌', error.formattedMessage);
      } else {
        console.log('⚠️ ', error.formattedMessage);
      }
    });
  }
  
  if (output.contracts && output.contracts['TimeCapsule.sol'] && output.contracts['TimeCapsule.sol']['TimeCapsule']) {
    console.log('✅ Contract compiled successfully!');
    console.log('📄 Contract ABI length:', JSON.stringify(output.contracts['TimeCapsule.sol']['TimeCapsule'].abi).length);
    
    // Save the ABI for testing
    fs.writeFileSync('test_abi.json', JSON.stringify(output.contracts['TimeCapsule.sol']['TimeCapsule'].abi, null, 2));
    console.log('💾 ABI saved to test_abi.json');
  } else {
    console.log('❌ Compilation failed - no contract output');
  }
} catch (e) {
  console.log('❌ Compilation error:', e.message);
}
