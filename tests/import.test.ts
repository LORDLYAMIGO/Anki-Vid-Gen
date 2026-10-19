import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {zipSync,strToU8} from 'fflate';
import {importFile} from '../src/import.ts';
import {textOf,validateCard} from '../src/core.ts';
describe('Anki adapter',()=>{
  it('imports separate basic, reversed and cloze cards',async()=>{const dir=await mkdtemp(join(tmpdir(),'anki-import-'));try{
    const dbPath=join(dir,'collection.sqlite'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE col(models TEXT); CREATE TABLE notes(id INTEGER,mid INTEGER,flds TEXT,tags TEXT); CREATE TABLE cards(id INTEGER,nid INTEGER,did INTEGER,ord INTEGER)');
    const models={1:{flds:[{name:'Front'},{name:'Back'}],tmpls:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'},{name:'Card 2',qfmt:'{{Back}}',afmt:'{{Front}}'}]},2:{type:1,flds:[{name:'Text'}],tmpls:[{name:'Cloze',qfmt:'{{cloze:Text}}',afmt:'{{cloze:Text}}'}]}};
    db.prepare('INSERT INTO col VALUES(?)').run(JSON.stringify(models));db.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(1,1,'front\x1fback',' tag ');db.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(2,2,'The {{c1::sun}} is {{c2::hot}}','');db.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(3,1,'Look <img src="x.png"> [sound:a.mp3]\x1fanswer','');for(const row of [[10,1,3,0],[11,1,3,1],[12,2,3,0],[13,2,3,1],[14,3,3,0]])db.prepare('INSERT INTO cards VALUES(?,?,?,?)').run(...row);db.close();
    const archive=zipSync({'collection.anki2':new Uint8Array(await readFile(dbPath)),media:strToU8('{"0":"x.png","1":"a.mp3"}'),'0':new Uint8Array([1,2,3]),'1':new Uint8Array([4,5,6])});const path=join(dir,'fixture.apkg');await writeFile(path,archive);const result=await importFile(path,join(dir,'assets'));expect(result.cards).toHaveLength(5);expect(result.cards[1].front[0]).toEqual({kind:'text',text:'back'});expect(result.cards[2].front[0]).toEqual({kind:'text',text:'The […] is hot'});expect(result.cards[3].back[0]).toEqual({kind:'text',text:'The sun is hot'});expect(result.cards[4].front.some(b=>b.kind==='image')).toBe(true);expect(result.cards[4].media.map(m=>m.kind).sort()).toEqual(['audio','image']);
  }finally{await rm(dir,{recursive:true,force:true});}});
  it('rejects a traversal entry',async()=>{const dir=await mkdtemp(join(tmpdir(),'anki-slip-'));try{const file=join(dir,'unsafe.apkg');await writeFile(file,zipSync({'../evil':strToU8('bad')}));await expect(importFile(file,join(dir,'assets'))).rejects.toThrow(/Unsafe archive entry/);}finally{await rm(dir,{recursive:true,force:true});}});
  it('extracts Jlab listening content and rejects duplicate reading and information cards',async()=>{const dir=await mkdtemp(join(tmpdir(),'anki-jlab-'));try{
    const dbPath=join(dir,'collection.sqlite'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE col(models TEXT,decks TEXT); CREATE TABLE notes(id INTEGER,mid INTEGER,flds TEXT,tags TEXT); CREATE TABLE cards(id INTEGER,nid INTEGER,did INTEGER,ord INTEGER)');
    const names=['Source','Audio','Image','RemarksBack','Jlab-Kanji','Jlab-ListeningFront','Jlab-ClozeFront','Jlab-ClozeBack'];
    const models={1:{flds:names.map(name=>({name})),tmpls:[{name:'Jlab-ListeningCard',qfmt:'{{Audio}}{{Image}}{{furigana:Jlab-ListeningFront}}<br>addon boilerplate',afmt:'{{RemarksBack}}'},{name:'Jlab-ClozeCard',qfmt:'{{furigana:Jlab-ClozeFront}}',afmt:'{{furigana:Jlab-ClozeBack}}'}]},2:{flds:[{name:'Image'},{name:'Text'}],tmpls:[{name:'InfoCard',qfmt:'{{Image}}<br>{{Text}}',afmt:'{{FrontSide}}'}]}};
    db.prepare('INSERT INTO col VALUES(?,?)').run(JSON.stringify(models),JSON.stringify({3:{name:'Course::Listening'},4:{name:'Course::Reading'}}));
    db.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(1,2,'\x1fRead me','');
    db.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(2,1,['Anime A','[sound:a.mp3]','<img src="x.jpg">','hello<br><br>Extra tip','こんにちは','konnichiha','konnichiha','konnichiha'].join('\x1f'),'');
    for(const row of [[10,1,3,0],[11,2,3,0],[12,2,4,1]])db.prepare('INSERT INTO cards VALUES(?,?,?,?)').run(...row);db.close();
    const archive=zipSync({'collection.anki2':new Uint8Array(await readFile(dbPath)),media:strToU8('{"0":"x.jpg","1":"a.mp3"}'),'0':new Uint8Array([1,2]),'1':new Uint8Array([3,4])});const file=join(dir,'deck.apkg');await writeFile(file,archive);
    const {cards}=await importFile(file,join(dir,'assets'));expect(cards).toHaveLength(3);expect(cards[1].source.cardOrdinal).toBe(1);expect(textOf(cards[1].front)).toBe('こんにちは');expect(textOf(cards[1].back)).toBe('hello');expect(textOf(cards[1].explanation)).toBe('Extra tip');expect(cards[1].media.map(m=>m.kind).sort()).toEqual(['audio','image']);expect(cards[1].narration?.questionAudioMediaId).toBeTruthy();expect(cards[1].source.attribution).toBe('Anime A');expect(validateCard(cards[1]).ok).toBe(true);expect(cards[0].skip).toBe(true);expect(cards[2].skip).toBe(true);
  }finally{await rm(dir,{recursive:true,force:true});}});
});
