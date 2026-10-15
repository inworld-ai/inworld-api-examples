#!/usr/bin/env node
/** Create the shared sample dictionary and retain it for the TTS example. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { clientFromEnvironment } = require('./example_pronunciation_dictionaries');

async function runCreate(client, {
    fixturePath = path.join(__dirname, '../sample-dictionary.json'),
    readFile = fs.readFile, log = console.log, id = randomUUID(),
} = {}) {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    const displayName = `${fixture.displayName.slice(0, 27)} ${id}`;
    log(`Creating dictionary: ${displayName}`);
    log('If the response is lost, find this exact displayName before creating another dictionary.');
    const dictionary = await client.createDictionary(displayName, fixture.pronunciations);
    client.resourcePath(dictionary.name);
    log(JSON.stringify(dictionary, null, 2));
    log(`PRONUNCIATION_DICTIONARY_NAME=${dictionary.name}`);
    log('Dictionary retained. Run the TTS example, then explicitly delete this dictionary when finished.');
    return dictionary;
}

if (require.main === module) {
    Promise.resolve().then(() => runCreate(clientFromEnvironment())).catch((error) => {
        console.error(`Create example failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { runCreate };
