process.env.DEBUG = '*';
import TuyAPI from 'tuyapi';

describe('Ceiling Fan Accessory', () => {

  jest.setTimeout(30000);

  it('should be able to turn on', async () => {
    const device = new TuyAPI({
      // id: 'bff9ec0ab7910d1763trij',
      // key: 'E{q~!S7D*+WF6DeP',
      'id': 'bfc4e4379df08fe6d5pzdr',
      'key': 'BU2ai1t6ZKrX@dQJ',
    });

    await device.find();
    await device.connect();

    // const dataRefresh = await new Promise((resolve) => device.on('dp-refresh', (data) =>resolve(data)));
    const data = await new Promise((resolve) => device.on('data', (data) =>resolve(data)));
    // @ts-ignore
    console.log(data);
    // console.log(dataRefresh);

  });
});
