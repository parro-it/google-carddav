let moduleRoot = '../es6';
if (process.env.TEST_RELEASE) {
  moduleRoot = '../dist';
}

const googleCarddav = require(moduleRoot);
import convert from 'xml-json';
import concat from 'concat-stream';


// should be a valid oauth2 access token
// with access granted to scope https://www.googleapis.com/auth/carddav
const accessToken = process.env.GOOGLE_ACCESS_TOKEN;

// ///////////////////////////////////////////////////

const fetch = global.fetch || require('node-fetch');

async function responseAsJSON(res, prop) {
  const xml = await res.text();
  return new Promise(resolve => {
    const converter = convert(prop);
    converter.pipe( concat(resolve) );
    converter.write(xml);
    converter.end();
  });
}

googleCarddav.listAddressBooks = async ({server, token, addressbookHomeSet}) => {
  const res = await fetch(`${server}${addressbookHomeSet}`, {
    method: 'PROPFIND',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'application/xml;charset=utf-8',
      Authorization: `Bearer ${token}`,
      Depth: 1
    },
    body: `<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
      <d:prop>
         <d:resourcetype />
         <d:displayname />
      </d:prop>
    </d:propfind>`
  });
  const responses = await responseAsJSON(res, 'd:response');

  const result = responses.map(resp => ({
    url: resp['d:href'],
    displayName: resp['d:propstat']['d:prop']['d:displayname'],
    resourceType: Object.keys(resp['d:propstat']['d:prop']['d:resourcetype'])[0].slice(2)
  }));
  return result;
};

googleCarddav.listContacts = async ({server, token, addressBookUrl}) => {
  const res = await fetch(`${server}${addressBookUrl}`, {
    method: 'REPORT',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'application/xml;charset=utf-8',
      Authorization: `Bearer ${token}`
    },
    body: `
      <card:addressbook-query xmlns:card="urn:ietf:params:xml:ns:carddav"
         xmlns:d="DAV:">
        <d:prop>
            <d:getetag />
            <card:address-data />
        </d:prop>
        <card:filter>
          <card:prop-filter name="FN">
          </card:prop-filter>
        </card:filter>
      </card:addressbook-query>`
  });
  const responses = await responseAsJSON(res, 'd:response');
  const result = responses.map(resp => ({
    url: resp['d:href'],
    etag: resp['d:propstat']['d:prop']['d:getetag'],
    vcard: resp['d:propstat']['d:prop']['card:address-data']
  }));
  return result;
};

googleCarddav.insertContact = async ({server, token, addressBookUrl, vcard}) => {
  const res = await fetch(`${server}${addressBookUrl}`, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'text/vcard;charset=utf-8',
      Authorization: `Bearer ${token}`
    },
    body: vcard
  });

  if (res.status !== 201) {
    throw new Error('Cannot insert contact: http status ' + res.status);
  }

  return {
    UID: res.headers.get('Location').split('/').slice(-1)[0],
    etag: res.headers.get('ETag')
  };
};


googleCarddav.getContact = async ({server, token, addressBookUrl, UID}) => {
  const res = await fetch(`${server}${addressBookUrl}${UID}`, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      Authorization: `Bearer ${token}`
    }
  });
  if (res.status === 404) {
    return null;
  }
  if (res.status !== 200) {
    throw new Error('Cannot get contact: http status ' + res.status);
  }
  return await res.text();
};

googleCarddav.deleteContact = async ({server, token, addressBookUrl, UID}) => {
  const res = await fetch(`${server}${addressBookUrl}${UID}`, {
    method: 'DELETE',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      Authorization: `Bearer ${token}`
    }
  });
  if (res.status !== 204) {
    throw new Error('Cannot delete contact: http status ' + res.status);
  }
  return await res.text();
};


googleCarddav.updateContact = async ({server, token, addressBookUrl, UID, vcard}) => {
  const res = await fetch(`${server}${addressBookUrl}${UID}`, {
    method: 'PUT',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/vcard;charset=utf-8'
    },
    body: vcard
  });

  if (res.status !== 204) {
    throw new Error('Cannot delete contact: http status ' + res.status);
  }
  return await res.text();
};


googleCarddav.discoverAccount = async ({server, token}) => {
  const res = await fetch(`${server}/.well-known/carddav`, {
    method: 'PROPFIND',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'application/xml;charset=utf-8',
      Authorization: `Bearer ${token}`
    },
    body: `<?xml version="1.0"?>
      <d:propfind xmlns:d="DAV:">
        <d:prop>
          <d:current-user-principal />
          <d:principal-URL />
        </d:prop>
      </d:propfind>`
  });

  const href = await responseAsJSON(res, 'd:prop');
  const result = {
    principalURL: href[0]['d:principal-URL']['d:href'],
    currentUserPrincipal: href[0]['d:current-user-principal']['d:href']
  };

  const res2 = await fetch(`${server}${result.principalURL}`, {
    method: 'PROPFIND',
    headers: {
      Accept: '*/*',
      'Connection': 'keep-alive',
      'Content-Type': 'application/xml;charset=utf-8',
      Authorization: `Bearer ${token}`
    },
    body: `<?xml version="1.0"?>
      <d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
        <d:prop>
           <card:addressbook-home-set />
        </d:prop>
      </d:propfind>`
  });

  const href2 = await responseAsJSON(res2, 'd:prop');
  result.addressbookHomeSet = href2[0]['card:addressbook-home-set']['d:href'];

  return result;
};

// ///////////////////////////////////////////////////

import testVCard from './fixture/vcards.json';

describe('googleCarddav', function googleCarddavTest() {
  this.timeout(60000);

  const opts = {
    server: 'https://www.googleapis.com',
    token: accessToken
  };

  let account;
  let addresses;

  before(async () => {
    account = await googleCarddav.discoverAccount(opts);
    addresses = await googleCarddav.listAddressBooks(Object.assign({
      addressbookHomeSet: account.addressbookHomeSet
    }, opts));
  });

  it('> discoverAccount find account details', () => {
    account.should.be.deep.equal({
      principalURL: '/carddav/v1/principals/imaptest73@gmail.com/',
      currentUserPrincipal: '/carddav/v1/principals/imaptest73@gmail.com',
      addressbookHomeSet: '/carddav/v1/principals/imaptest73@gmail.com/lists/'
    });
  });

  it('> listAddressBooks return all addressbook addresses in account', () => {
    addresses.should.be.deep.equal([{
      url: '/carddav/v1/principals/imaptest73@gmail.com/lists/',
      displayName: 'Homeset',
      resourceType: 'collection'
    }, {
      url: '/carddav/v1/principals/imaptest73@gmail.com/lists/default/',
      displayName: 'Address Book',
      resourceType: 'collection'
    }]);
  });

  it('> listContacts return all contacts in a addressbook', async () => {
    const contacts = await googleCarddav.listContacts(Object.assign({
      addressBookUrl: addresses[1].url
    }, opts));

    contacts.should.be.deep.equal(testVCard.slice(0, 2));
  });


  it('> getContact retrieve a contact by uid', async () => {
    const contact = await googleCarddav.getContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: '1742e6128980c7d7'
    }, opts));

    contact.should.be.equal(testVCard[1].vcard);
  });


  it('> insertContact insert a new contact in addressbook', async () => {
    const vcard = testVCard[1].vcard
      .replace(/Test/g, 'AnotherTest');


    const response = await googleCarddav.insertContact(Object.assign({
      addressBookUrl: addresses[1].url,
      vcard: vcard
    }, opts));


    response.should.be.a('object');
    response.UID.should.be.a('string');
    response.etag.should.be.a('string');

    const contact = await googleCarddav.getContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));

    const expectedVcard = vcard
      .replace(/REV:.*\r\n/g, '')
      .replace(/UID:1742e6128980c7d7/g, 'UID:' + response.UID);

    contact.replace(/REV:.*\r\n/g, '')
      .should.be.deep.equal(expectedVcard);


    await googleCarddav.deleteContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));
  });


  it('> deleteContact delete a contact by uid', async () => {
    const response = await googleCarddav.insertContact(Object.assign({
      addressBookUrl: addresses[1].url,
      vcard: testVCard[1].vcard
    }, opts));

    await googleCarddav.deleteContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));

    const contact = await googleCarddav.getContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));

    should.equal(null, contact);
  });

  it('> updateContact update a contact by uid', async () => {
    const response = await googleCarddav.insertContact(Object.assign({
      addressBookUrl: addresses[1].url,
      vcard: testVCard[1].vcard.replace(/Test/g, 'AnotherTest')
    }, opts));

    await googleCarddav.updateContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID,
      vcard: testVCard[1].vcard.replace(/Test/g, 'AnotherTestUpdated')
    }, opts));

    const contact = await googleCarddav.getContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));

    contact.replace(/REV:.*\r\n/g, '')

      .should.be.equal(
        testVCard[1].vcard
          .replace(/Test/g, 'AnotherTestUpdated')
          .replace(/REV:.*\r\n/g, '')
          .replace(/UID:.*\r\n/g, `UID:${response.UID}\r\n`)
      );

    await googleCarddav.deleteContact(Object.assign({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    }, opts));
  });
});

