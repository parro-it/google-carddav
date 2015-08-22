let moduleRoot = '../es6';
if (process.env.TEST_RELEASE) {
  moduleRoot = '../dist';
}


// should be a valid oauth2 access token
// in json format as per https://github.com/cayasso/access-token
// with access granted to scope https://www.googleapis.com/auth/carddav

import tokenData from '../private/google.json';
import AccessToken from 'access-token';

import testVCard from './fixture/vcards.json';
import thenify from 'thenify';

const accessToken = new AccessToken(tokenData);
const token = accessToken.token(tokenData.token);

const getToken = thenify(token.get).bind(token);

const _googleCarddav = require(moduleRoot);


describe('googleCarddav', function googleCarddavTest() {
  this.timeout(60000);

  let googleCarddav;
  let account;
  let addresses;

  before(async () => {
    const freshToken = await getToken();
    const opts = {
      server: 'https://www.googleapis.com',
      token: freshToken[0].access_token
    };
    googleCarddav = _googleCarddav(opts);


    account = await googleCarddav.discoverAccount();
    addresses = await googleCarddav.listAddressBooks({
      addressbookHomeSet: account.addressbookHomeSet
    });
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
    const contacts = await googleCarddav.listContacts({
      addressBookUrl: addresses[1].url
    });

    contacts.should.be.deep.equal(testVCard.slice(0, 2));
  });


  it('> getContact retrieve a contact by uid', async () => {
    const contact = await googleCarddav.getContact({
      addressBookUrl: addresses[1].url,
      UID: '1742e6128980c7d7'
    });

    contact.should.be.equal(testVCard[1].vcard);
  });


  it('> insertContact insert a new contact in addressbook', async () => {
    const vcard = testVCard[1].vcard
      .replace(/Test/g, 'AnotherTest');


    const response = await googleCarddav.insertContact({
      addressBookUrl: addresses[1].url,
      vcard: vcard
    });


    response.should.be.a('object');
    response.UID.should.be.a('string');
    response.etag.should.be.a('string');

    const contact = await googleCarddav.getContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });

    const expectedVcard = vcard
      .replace(/REV:.*\r\n/g, '')
      .replace(/UID:1742e6128980c7d7/g, 'UID:' + response.UID);

    contact.replace(/REV:.*\r\n/g, '')
      .should.be.deep.equal(expectedVcard);


    await googleCarddav.deleteContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });
  });


  it('> deleteContact delete a contact by uid', async () => {
    const response = await googleCarddav.insertContact({
      addressBookUrl: addresses[1].url,
      vcard: testVCard[1].vcard
    });

    await googleCarddav.deleteContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });

    const contact = await googleCarddav.getContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });

    should.equal(null, contact);
  });

  it('> updateContact update a contact by uid', async () => {
    const response = await googleCarddav.insertContact({
      addressBookUrl: addresses[1].url,
      vcard: testVCard[1].vcard.replace(/Test/g, 'AnotherTest')
    });

    await googleCarddav.updateContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID,
      vcard: testVCard[1].vcard.replace(/Test/g, 'AnotherTestUpdated')
    });

    const contact = await googleCarddav.getContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });

    contact.replace(/REV:.*\r\n/g, '')

      .should.be.equal(
        testVCard[1].vcard
          .replace(/Test/g, 'AnotherTestUpdated')
          .replace(/REV:.*\r\n/g, '')
          .replace(/UID:.*\r\n/g, `UID:${response.UID}\r\n`)
      );

    await googleCarddav.deleteContact({
      addressBookUrl: addresses[1].url,
      UID: response.UID
    });
  });
});

