/*
 * CombatMaster
 * Version 3.1.0 (D&D 2024 / Beacon sheet edition)
 * Original by Robin Kuiper
 * Changes in Version 0.3.0 and greater by Victor B
 * Changes in prior versions by The Aaron
 * Github: https://github.com/vicberg/CombatMaster
 *
 *
 * D&D 2024 (Beacon) support
 *  - Sheet values are read with getSheetItem(), then getComputed() for Beacon
 *    characters, then getAttrByName() for legacy characters (2014 OGL, Shaped, PF2).
 *    Missing values are reported to the GM once per character instead of silently using 0.
 *  - Initiative is awaited before combat starts. Group-Init waits for GroupInitiative.
 *  - 2024 initiative rules: Invisible gives Advantage, Incapacitated gives Disadvantage.
 *  - Spell detection reads 2024 "advancedroll" chat cards. Sheet options: Auto, DND2024,
 *    OGL, Shaped, PF2. Duplicate cards from one cast are ignored.
 *  - Concentration uses the 2024 rules: DC 10 or half the damage (max 30), optional
 *    automatic save roll, and Concentration ends when the caster becomes Incapacitated.
 *  - Default conditions follow the 2024 rules (SRD 5.2, CC-BY-4.0), Exhaustion added.
 *
 * Safety and fixes
 *  - Setup, reset, import and combat control are GM only. Players can only end or delay
 *    their own turn, and only add or remove conditions when "Player Allowed Changes" is on.
 *  - Turn markers are tracked by id (no duplicates, never added to the tracker outside combat).
 *  - Clearing the Turn Tracker by hand stops combat cleanly.
 *  - Many crash guards and old bugs fixed (see the chat message that came with this file).
 *  - Underscore.js is no longer required.
 *
 * IMPORTANT: Games that use a Beacon sheet (D&D 2024 by Roll20) must set
 * Settings > Mod (API) Scripts > API Sandbox Version to "Experimental".
 * After restarting, the sandbox log must say EXPERIMENTAL.
 */
var CombatMaster = CombatMaster || (function() {
    'use strict';

    let round = 1,
        version = '3.1.0',
        timerObj,
        intervalHandle,
        animationHandle,
        debug = false,
        paused = false,
        markerWarned = false,
        who = 'gm',
        playerID = null,
        markers = [],
        observers = {
            tokenChange: []
        },
        warnedCharacters = {},
        recentSpellCasts = {},
        recentConcentrationChecks = {},
        startImage = '4',
        pauseImage = '5',
        stopImage = '6',
        tagImage = '3',
        deleteImage = '#',
        sortImage = '1',
        backImage = 'y',
        nextImage = ']',
        prevImage = '[',
        timerImage = 't',
        favoriteImage = 'S',
        allConditionsImage = 'G',
        addImage = '&',
        doneImage = '3',
        showImage = 'v',
        delayImage = '}',
        holdImage = 'L',
        helpImage = 'i';

    //Styling for the chat responses.
    const styles = {
        reset: 'padding: 0; margin: 0;',
        menu:  'background-color: #fff; border: 1px solid #000; padding: 5px; border-radius: 5px;',
        title: 'font-size:14px;font-weight:bold;background-color:black;padding:3px;border-top-left-radius:3px;border-top-right-radius:3px',
        titleText: 'color:white',
        version:'font-size:10px;',
        header: 'margin-top:10px;margin-bottom:5px;font-weight:bold;font-style:italic;display:inline-block;',
        textButton: 'background-color:#fff; color: #000; text-align: center; float: right;',
        conditionButton: 'background-color:#fff; color: #000;margin-left:1px;',
        textLabel: 'background-color:#fff;float:left;text-align:center;margin-top:8px',
        bigButton: 'width:80%;border-radius:5px;text-align:center;margin-left:15px',
        bigButtonLink: 'background-color:#000000; border-radius: 5px; padding: 5px; color: #fff; text-align: center;width:100%',
        list: 'list-style: none;padding:2px',
        overflow: 'overflow: hidden;',
        background: 'background-color:lightgrey',
        buttonRight: 'display:inline-block;float:right;vertical-align:middle',
        announcePlayer: 'display:inline-block;vertical-align:middle',
    },

    icon_image_positions = {red:"#C91010",blue:"#1076C9",green:"#2FC910",brown:"#C97310",purple:"#9510C9",pink:"#EB75E1",yellow:"#E5EB75",dead:"X",skull:0,sleepy:34,"half-heart":68,"half-haze":102,interdiction:136,snail:170,"lightning-helix":204,spanner:238,"chained-heart":272,"chemical-bolt":306,"death-zone":340,"drink-me":374,"edge-crack":408,"ninja-mask":442,stopwatch:476,"fishing-net":510,overdrive:544,strong:578,fist:612,padlock:646,"three-leaves":680,"fluffy-wing":714,pummeled:748,tread:782,arrowed:816,aura:850,"back-pain":884,"black-flag":918,"bleeding-eye":952,"bolt-shield":986,"broken-heart":1020,cobweb:1054,"broken-shield":1088,"flying-flag":1122,radioactive:1156,trophy:1190,"broken-skull":1224,"frozen-orb":1258,"rolling-bomb":1292,"white-tower":1326,grab:1360,screaming:1394,grenade:1428,"sentry-gun":1462,"all-for-one":1496,"angel-outfit":1530,"archery-target":1564},
    ctMarkers = ['blue', 'brown', 'green', 'pink', 'purple', 'red', 'yellow', '-', 'all-for-one', 'angel-outfit', 'archery-target', 'arrowed', 'aura', 'back-pain', 'black-flag', 'bleeding-eye', 'bolt-shield', 'broken-heart', 'broken-shield', 'broken-skull', 'chained-heart', 'chemical-bolt', 'cobweb', 'dead', 'death-zone', 'drink-me', 'edge-crack', 'fishing-net', 'fist', 'fluffy-wing', 'flying-flag', 'frozen-orb', 'grab', 'grenade', 'half-haze', 'half-heart', 'interdiction', 'lightning-helix', 'ninja-mask', 'overdrive', 'padlock', 'pummeled', 'radioactive', 'rolling-bomb', 'screaming', 'sentry-gun', 'skull', 'sleepy', 'snail', 'spanner', 'stopwatch','strong', 'three-leaves', 'tread', 'trophy', 'white-tower'],
    shaped_conditions = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'],

    // 2024 rules: these conditions include Incapacitated
    incapacitatingConditions = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'],

    script_name = 'CombatMaster',
    combatState = 'COMBATMASTER',

    // character.charactersheetname values of sheets built on Beacon
    beaconSheetNames = ['dnd2024byroll20'],
    defaultMarkerURLs = {
        current: 'https://s3.amazonaws.com/files.d20.io/images/52550079/U-3U950B3wk_KRtspSPyuw/thumb.png?1524507826',
        next: 'https://s3.amazonaws.com/files.d20.io/images/66352183/90UOrT-_Odg2WvvLbKOthw/thumb.png?1541422636'
    },
    // Returned when a turn marker cannot be created, so callers never crash
    nullMarker = {
        id: '',
        isNull: true,
        get: function (key) { return (key === 'id' || key === '_id') ? '' : undefined; },
        set: function () {},
        remove: function () {}
    },

//*************************************************************************************************************
//SHEET ACCESS (Beacon + legacy)
//*************************************************************************************************************
    reportError = function (where, err) {
        const text = (err && err.message) ? err.message : String(err);
        log(script_name + ' error in ' + where + ': ' + text);
        if (debug && err && err.stack) {
            log(err.stack);
        }
    },

    isBeaconCharacter = function (characterObj) {
        if (!characterObj) {
            return false;
        }
        return beaconSheetNames.includes(String(characterObj.get('charactersheetname') || '').toLowerCase());
    },

    isEmptyValue = function (v) {
        return v === undefined || v === null || v === '' ||
            (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    },

    // Some Beacon values come back as objects like {value: 3}
    unwrapValue = function (value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.value !== undefined) { return value.value; }
            if (value.current !== undefined) { return value.current; }
            if (value.total !== undefined) { return value.total; }
        }
        return value;
    },

    // Reads one value from a character sheet. Always returns a Promise.
    // 1. getSheetItem   (Experimental sandbox, Beacon and legacy sheets)
    // 2. getComputed    (Beacon computed values like initiative_bonus)
    // 3. getAttrByName  (legacy sheets only, avoids error spam on Beacon characters)
    getSheetValue = async function (characterId, name, type = 'current') {
        name = String(name || '').trim();
        if (!characterId || !name || name === 'None') {
            return undefined;
        }

        const beacon = isBeaconCharacter(getObj('character', characterId));
        let value;

        if (typeof getSheetItem === 'function') {
            try {
                value = unwrapValue(await getSheetItem(characterId, name, type));
            } catch (e) {
                if (debug) { reportError('getSheetItem(' + name + ')', e); }
            }
        }

        if (isEmptyValue(value) && beacon && type === 'current' && typeof getComputed === 'function') {
            try {
                value = unwrapValue(await getComputed({characterId: characterId, property: name}));
            } catch (e) {
                if (debug) { reportError('getComputed(' + name + ')', e); }
            }
        }

        if (isEmptyValue(value) && !beacon && typeof getAttrByName === 'function') {
            try {
                value = unwrapValue(getAttrByName(characterId, name, type));
            } catch (e) {
                if (debug) { reportError('getAttrByName(' + name + ')', e); }
            }
        }

        return isEmptyValue(value) ? undefined : value;
    },

    // Returns a number, or undefined if the value is missing or not a number
    getSheetNumber = async function (characterId, name, type = 'current') {
        const value = parseFloat(await getSheetValue(characterId, name, type));
        return Number.isFinite(value) ? value : undefined;
    },

    warnMissingAttributes = function (characterObj, missing) {
        if (!characterObj || warnedCharacters[characterObj.id]) {
            return;
        }
        warnedCharacters[characterObj.id] = true;

        let text = 'Could not read <b>' + HE(missing.join(', ')) + '</b> from <b>' + HE(characterObj.get('name') || '') + '</b>. Using 0 instead.';
        if (isBeaconCharacter(characterObj) && typeof getSheetItem !== 'function') {
            text += '<br><br>This character uses the <b>D&amp;D 2024</b> sheet. Set the API Sandbox to <b>Experimental</b> and restart the sandbox.';
        }
        makeAndSendMenu(text, 'Sheet Warning', 'gm');
    },

    // Returns capture group 1 of the first pattern that matches (never a stale match)
    firstMatch = function (text, patterns) {
        text = String(text || '');
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] !== undefined && String(match[1]).trim() !== '') {
                return String(match[1]).trim();
            }
        }
        return '';
    },

    getRollMatch = function (text, regex) {
        return firstMatch(text, [regex]);
    },

    stripHtml = function (text) {
        return String(text || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    },

    isBeaconRollMessage = function (msg) {
        return msg.type === 'advancedroll' || String(msg.content || '').indexOf('header__title') !== -1;
    },

    // Reads a spell card from the D&D 2024 by Roll20 sheet ("advancedroll" message).
    // Roll20 says the card layout may still change, so matching is kept loose on purpose.
    parse2024SpellCard = function (msg) {
        const content = String(msg.content || '');
        const title   = stripHtml(firstMatch(content, [/header__title[^>]*>([\s\S]*?)<\//i, /data-title\s*=\s*["']([^"']+)["']/i]));
        if (!title) {
            return null;
        }

        // Spell cards have a subtitle like "Level 3 Evocation" or "Evocation Cantrip"
        const subtitle = stripHtml(firstMatch(content, [/header__subtitle[^>]*>([\s\S]*?)<\//i]));
        const level    = getRollMatch(subtitle, /level\s*(\d+)/i);
        if (!level && !/cantrip/i.test(subtitle)) {
            return null;
        }

        const plain = stripHtml(content);
        const concentrate = /concentration/i.test(subtitle) ||
            /data-chip\s*=\s*["']?concentration["']?/i.test(content) ||
            /data-[a-z-]*\s*=\s*["']?concentration["']?/i.test(content) ||
            /concentration\s*[,:]?\s*up\s*to/i.test(plain) ||
            /duration\W{0,10}concentration/i.test(plain);

        let duration = 1;
        const durationMatch = plain.match(/(?:up\s*to|duration[^0-9]{0,40}?)\s*(\d+)\s*(round|minute|hour)/i);
        if (durationMatch) {
            const amount = parseInt(durationMatch[1]) || 1;
            const unit   = durationMatch[2].toLowerCase();
            duration = (unit === 'round') ? amount : (unit === 'minute') ? amount * 10 : amount * 600;
        }

        let description = stripHtml(firstMatch(content, [/class\s*=\s*["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]));
        if (description.length > 1000) {
            description = description.slice(0, 1000) + '...';
        }

        return {
            spellName: title,
            spellLevel: level || '0',
            concentrate: concentrate,
            description: description,
            duration: duration,
            characterID: firstMatch(content, [/data-character-id\s*=\s*["']([^"']+)["']/i, /data-characterid\s*=\s*["']([^"']+)["']/i]),
            characterName: stripHtml(firstMatch(content, [/meta__character[^>]*>([\s\S]*?)<\//i, /data-character-name\s*=\s*["']([^"']+)["']/i])) || msg.who || ''
        };
    },

    // Finds the caster's token: player's current page first, then the player ribbon page
    findCasterToken = function (characterID, characterName, msg) {
        let characterObj = characterID ? getObj('character', characterID) : null;
        if (!characterObj && characterName) {
            characterObj = findObjs({_type: 'character', name: characterName})[0];
        }
        if (!characterObj && msg && msg.who) {
            characterObj = findObjs({_type: 'character', name: msg.who})[0];
        }

        if (characterObj) {
            const pages  = [];
            const player = msg ? getObj('player', msg.playerid) : null;
            if (player && player.get('lastpage')) {
                pages.push(player.get('lastpage'));
            }
            pages.push(Campaign().get('playerpageid'));

            for (const pageid of pages) {
                const tokenObj = findObjs({_type: 'graphic', _pageid: pageid, represents: characterObj.id})[0];
                if (tokenObj) {
                    return tokenObj;
                }
            }
        }
        if (msg && msg.selected && msg.selected.length) {
            return getObj('graphic', msg.selected[0]._id);
        }
        return null;
    },

    // Waits until another script (GroupInitiative) has filled the turn order
    waitForTurnorder = function (timeout = 10000) {
        return new Promise(resolve => {
            let waited = 0;
            const check = () => {
                if (getTurnorder().length > 0) {
                    setTimeout(() => resolve(true), 500);
                    return;
                }
                if (waited >= timeout) {
                    resolve(false);
                    return;
                }
                waited += 250;
                setTimeout(check, 250);
            };
            check();
        });
    },

    // True if this player controls the token whose turn it is
    playerOwnsCurrentTurn = function (playerid) {
        const turn     = getCurrentTurn();
        const tokenObj = turn ? getObj('graphic', turn.id) : null;
        if (!tokenObj) {
            return false;
        }
        const characterObj = getObj('character', tokenObj.get('represents'));
        const controllers  = String(tokenObj.get('controlledby') || '') + ',' + String(characterObj ? characterObj.get('controlledby') : '');
        return controllers.split(',').some(id => id === playerid || id === 'all');
    },

//*************************************************************************************************************
//INPUT
//*************************************************************************************************************
    inputHandler = function(msg_orig) {
        if (!msg_orig || typeof msg_orig.content !== 'string') {
            return;
        }

        const status = state[combatState].config.status;
        const fromAPI = msg_orig.type === 'api' || msg_orig.playerid === 'API';

        if (status.logRolls && !fromAPI && msg_orig.who !== script_name) {
            log(`${script_name} RAW MESSAGE (type: ${msg_orig.type}, template: ${msg_orig.rolltemplate || 'none'}, who: ${msg_orig.who}): ${msg_orig.content}`);
        }

        if (status.autoAddSpells && !fromAPI) {
            try {
                const sheet = status.sheet;
                if ((sheet == 'OGL' || sheet == 'Auto') && msg_orig.rolltemplate === 'spell') {
                    handleSpellCast(msg_orig, 'OGL');
                } else if ((sheet == 'DND2024' || sheet == 'Auto') && isBeaconRollMessage(msg_orig)) {
                    handleSpellCast(msg_orig, 'DND2024');
                } else if (sheet == 'Shaped' && msg_orig.content.includes("{{spell=1}}")) {
                    handleSpellCast(msg_orig, 'Shaped');
                } else if (sheet == 'PF2' && msg_orig.content.includes("{cast}")) {
                    handleSpellCast(msg_orig, 'PF2');
                }
            } catch (err) {
                reportError('Spell Detection', err);
            }
        }

        if (msg_orig.type !== 'api' || msg_orig.content.indexOf('!cmaster') !== 0) {
            return;
        }

        const msg = Object.assign({}, msg_orig);
        let restrict;

        playerID = msg.playerid;
        if (msg.playerid === 'API' || playerIsGM(msg.playerid)) {
            if (msg.playerid !== 'API') {
                state[combatState].config.gmPlayerID = msg.playerid;
            }
            who = 'gm';
        } else {
            const playerObj = getObj('player', msg.playerid);
            if (!playerObj) {
                return;
            }
            who = playerObj.get('displayname');
        }

        if (Array.isArray(msg.inlinerolls) && msg.inlinerolls.length) {
            msg.content = inlineExtract(msg);
        }

        try {
            if (/^!cmaster\s+--import\b/.test(msg.content)) {
                const cmdDetails = { action: 'import', details: {} };
                msg.content = msg.content.replace(/^!cmaster\s+/, '');
                cmdDetails.details['config'] = msg.content.replace(/^--import,?/, '');
                commandHandler(cmdDetails, msg, restrict, who, playerID);
            } else {
                const args = msg.content.split(/\s+--/);
                if (args[0] === '!cmaster') {
                    if (args[1]) {
                        args.slice(1).forEach((cmd) => {
                            const cmdDetails = cmdExtract(cmd);
                            if (debug) {
                                log(cmdDetails);
                            }
                            commandHandler(cmdDetails, msg, restrict, who, playerID);
                        });
                    } else {
                        sendMainMenu(who);
                    }
                }
            }
        } catch (err) {
            reportError('Command', err);
            makeAndSendMenu('Something went wrong. Check the Mod (API) console log for details.', 'CombatMaster Error', 'gm');
        }
    },

    //Extracts inline rolls
    inlineExtract = function(msg){
        return (msg.inlinerolls || []).reduce((content, roll, index) => {
            const total = (roll && roll.results && roll.results.total) || 0;
            return content.split('$[['+index+']]').join(total);
        }, msg.content);
    },

    //Extracts the command details from a command string passed from handleInput
    cmdExtract = function(cmd){
        var cmdSep = {
            details: {}
        },
        vars,
        temp;

        if (debug) {
            log(cmd);
        }

        let values = parseLine(cmd);
        let lookup = values.lookup;
        let tokens = values.tokens;

        cmdSep.action = String(tokens).match(/turn|show|config|back|reset|main|remove|add|new|delete|import|export|help|spell|ignore|clear/);

        String(tokens).replace(cmdSep.action+',','').split(',').forEach((d) => {
            vars=d.match(/(who|next|main|previous|delay|start|stop|hold|timer|pause|show|all|favorites|setup|conditions|condition|sort|combat|turnorder|accouncements|macro|status|list|export|import|type|key|value|tracker|confirm|direction|duration|message|initiative|config|assigned|action|description|target|id|started|stopped|held|addAPI|remAPI|concentration|view|)(?:\:|=)([^,]+)/) || null;
            if(vars) {
                if (vars[2].includes('INDEX')) {
                    let key, result;
                    for (key in lookup) {
                        result = lookup[key].replace(/{/g, '');
                        result = result.replace(/}/g, '');
                        vars[2] = vars[2].replace('{INDEX:' + key + '}', result);
                    }
                }
                temp = (vars[2] === 'true') ? true : (vars[2] === 'false') ? false : vars[2];
                cmdSep.details[vars[1]]=temp;
            } else {
                cmdSep.details[d]=d;
            }
        });

        return cmdSep;
    },

    parseLine = function(cmd) {
        let lookup = [];
        let depth = 0;
        let lastc = '';
        let capture = '';
        let line = '';

        [...cmd].forEach((c)=>{
            if('{' === lastc && '{' === c) {
                ++depth;
            }
            if('}' === lastc && '}' === c) {
                --depth;
                if(!depth && capture.length){
                    line+=`INDEX:${lookup.length}`;
                    lookup.push(capture);
                    capture='';
                }
            }

            if(depth){
                capture+=c;
            } else {
                line+=c;
            }

            lastc = c;
        });

        let tokens = line.split(/\s+--/);
        return {
            lookup,
            tokens
        };
    },

    commandHandler = function(cmdDetails,msg,restrict,who,playerID){
        if (debug){
            log ('Command Handler');
            log (cmdDetails.action);
        }

        // Setup and combat control are GM only
        if (who != 'gm') {
            const gmOnlyActions = ['config','new','delete','import','reset','ignore','spell','clear','export'];
            const action = String(cmdDetails.action);
            const d = cmdDetails.details;

            if (gmOnlyActions.includes(action) || (action == 'show' && (d.setup || d.initiative || d.turnorder || d.timer || d.announce || d.macro || d.status || d.concentration || d.conditions || d.export || d.condition))) {
                makeAndSendMenu('Only the GM can use this command.', 'CombatMaster', who);
                return;
            }
            if (action == 'turn') {
                if (d.start || d.stop || d.hold || d.sort || d.previous || d.timer) {
                    makeAndSendMenu('Only the GM can control combat.', 'CombatMaster', who);
                    return;
                }
                if ((d.next || d.delay) && !playerOwnsCurrentTurn(playerID)) {
                    makeAndSendMenu('You can only end or delay your own turn.', 'CombatMaster', who);
                    return;
                }
            }
            if ((action == 'add' || action == 'remove') && !state[combatState].config.status.userChanges) {
                makeAndSendMenu('Only the GM can change conditions.', 'CombatMaster', who);
                return;
            }
        }

        if (cmdDetails.action == 'back'){
            if (cmdDetails.details.setup) {
                cmdDetails.action = 'show';
                cmdDetails.details['setup'] = true;
            } else if (cmdDetails.details.tracker) {
                cmdDetails.action = 'main';
            } else {
                if (state[combatState].config.previousPage == 'main') {
                    cmdDetails.action = 'main';
                } else {
                    cmdDetails.action = 'show';
                    cmdDetails.details['conditions'] = true;
                }
            }
        }

        if (cmdDetails.action == 'main' || !cmdDetails.action){
            sendMainMenu(who);
        }
        if (cmdDetails.action == 'turn'){
            if (cmdDetails.details.next) {
                nextTurn();
            }
            if (cmdDetails.details.delay) {
                delayTurn().catch(err => reportError('Delay Turn', err));
            }
            if (cmdDetails.details.previous) {
                previousTurn();
            }
            if (cmdDetails.details.start) {
                startCombat(msg.selected, who).catch(err => reportError('Start Combat', err));
            }
            if (cmdDetails.details.stop) {
                stopCombat(who);
            }
            if (cmdDetails.details.hold) {
                holdCombat(who);
            }
            if (cmdDetails.details.timer == 'pause') {
                pauseTimer();
            }
            if (cmdDetails.details.timer == 'stop') {
                stopTimer();
            }
            if (cmdDetails.details.sort) {
                sortTurnorder();
            }
        }

        if (cmdDetails.action == 'show'){
            if (cmdDetails.details.view) {
                editShowState(cmdDetails.details.value);
            }
            if (cmdDetails.details.setup) {
                sendConfigMenu();
            }
            if (cmdDetails.details.initiative) {
                sendInitiativeMenu();
            }
            if (cmdDetails.details.turnorder) {
                sendTurnorderMenu();
            }
            if (cmdDetails.details.timer) {
                sendTimerMenu();
            }
            if (cmdDetails.details.announce) {
                sendAnnounceMenu();
            }
            if (cmdDetails.details.macro) {
                sendMacroMenu();
            }
            if (cmdDetails.details.status) {
                sendStatusMenu();
            }
            if (cmdDetails.details.concentration) {
                sendConcentrationMenu();
            }
            if (cmdDetails.details.conditions) {
                sendConditionsMenu();
            }
            if (cmdDetails.details.export) {
                exportConditions();
            }
            if (cmdDetails.details.condition) {
                if (cmdDetails.details.addAPI) {
                    sendConditionAddAPIMenu(cmdDetails.details.condition);
                } else if (cmdDetails.details.remAPI) {
                    sendConditionRemAPIMenu(cmdDetails.details.condition);
                } else {
                    sendConditionMenu(cmdDetails.details.condition);
                }
            }
            if (cmdDetails.details.assigned) {
                showConditions(msg.selected);
            }
            if (cmdDetails.details.description) {
                sendConditionToChat(cmdDetails.details.key);
            }
        }

        if (cmdDetails.action == 'add') {
            if (cmdDetails.details.target) {
                addTargetsToCondition(msg.selected,cmdDetails.details.id,cmdDetails.details.condition);
            } else if (cmdDetails.details.condition) {
                addCondition(cmdDetails,msg.selected,playerID);
            }
        }

        if (cmdDetails.action == 'remove') {
            if (cmdDetails.details.condition) {
                removeCondition(cmdDetails, msg.selected);
            }
        }

        if (cmdDetails.action == 'config'){
            editCombatState(cmdDetails);
        }

        if (cmdDetails.action == 'new'){
            if (cmdDetails.details.condition) {
                newCondition(cmdDetails.details.condition);
            } else if (cmdDetails.details.macro) {
                newSubstitution(cmdDetails);
            }
        }

        if (cmdDetails.action == 'delete'){
            if (cmdDetails.details.condition) {
                deleteCondition(cmdDetails.details.condition,cmdDetails.details.confirm);
            } else if (cmdDetails.details.macro) {
                removeSubstitution(cmdDetails);
            }
        }

        if (cmdDetails.action == 'import') {
            importCombatMaster(cmdDetails.details.config);
        }

        if (cmdDetails.action == 'spell') {
            if (cmdDetails.details.confirm) {
                addSpell(cmdDetails.details.key);
            } else {
                ignoreSpell(cmdDetails.details.key);
            }
        }

        if (cmdDetails.action == 'reset') {
            state[combatState] = {};
            setDefaults(true);
            sendMainMenu(who);
        }
        if (cmdDetails.action == 'ignore') {
            state[combatState].ignores = [];
            sendMainMenu(who);
        }
        if (cmdDetails.action == 'clear') {
            clearTokenStatuses(msg.selected);
            sendMainMenu(who);
        }
        if (cmdDetails.action == 'help') {
            showHelp(cmdDetails);
        }
    },

    clearTokenStatuses = function(selectedTokens) {
        if (selectedTokens) {
            selectedTokens.forEach(token => {
                if (token._type == 'graphic') {
                    let tokenObj = getObj('graphic', token._id);
                    if (tokenObj) {
                        tokenObj.set('statusmarkers', "");
                    }
                }
            });
        }
    },

//*************************************************************************************************************
//MENUS
//*************************************************************************************************************
    sendMainMenu = function(who) {
        if (debug) {
            log('Send Main Menu');
        }

        let nextButton          = makeImageButton('!cmaster --turn,next',nextImage,'Next Turn','transparent',18);
        let prevButton          = makeImageButton('!cmaster --turn,previous',prevImage,'Previous Turn','transparent',18);
        let stopButton          = makeImageButton('!cmaster --turn,stop',stopImage,'Stop Combat','transparent',18);
        let holdButton          = makeImageButton('!cmaster --turn,hold',holdImage,'Hold Combat','transparent',18);
        let startButton         = makeImageButton('!cmaster --turn,start',startImage,'Start Combat','transparent',18);
        let pauseTimerButton    = makeImageButton('!cmaster --turn,timer=pause',pauseImage,'Pause Timer','transparent',18);
        let stopTimerButton     = makeImageButton('!cmaster --turn,timer=stop',timerImage,'Stop Timer','transparent',18);
        let configButton        = makeImageButton('!cmaster --show,setup',backImage,'Show Setup','transparent',18);
        let showButton          = makeImageButton('!cmaster --show,assigned',showImage,'Show Conditions','transparent',18);
        let sortButton          = makeImageButton('!cmaster --turn,sort',sortImage,'Sort Turnorder','transparent',18);
        let helpButton;

        if (state[combatState].config.hold.held) {
            helpButton          = makeImageButton('!cmaster --help,held',helpImage,'Help','transparent',18,'white');
        } else if (inFight() ) {
            helpButton          = makeImageButton('!cmaster --help,started',helpImage,'Help','transparent',18,'white');
        } else {
            helpButton          = makeImageButton('!cmaster --help,stopped',helpImage,'Help','transparent',18,'white');
        }

        let listItems           = [];
        let titleText           = 'CombatMaster Menu<span style="'+styles.version+'"> ('+version+')</span>'+'<span style="'+styles.buttonRight+'">'+helpButton+'</span>';
        let contents, key, condition, conditions, conditionButton, addButton, removeButton, favoriteButton, listContents, rowCount=1;

        if (state[combatState].config.hold.held) {
            contents = '<div style="background-color:yellow">'+startButton;
        } else if (inFight() ) {
            contents = '<div style="background-color:green;width:100%;padding:2px;vertical-align:middle">'+stopButton + holdButton + prevButton + nextButton + pauseTimerButton + stopTimerButton + showButton + sortButton;
        } else {
            contents = '<div style="background-color:red">'+startButton;
        }

        contents += configButton;
        contents += '</div>';

        conditions = sortObject(state[combatState].config.conditions);

        for (key in conditions) {
            condition       = getConditionByKey(key);

            let installed = verifyInstalls(condition.iconType);
            if (!installed) {
                return;
            }

            conditionButton = makeImageButton('!cmaster --show,condition='+key,backImage,'Edit Condition','transparent',12);
            removeButton    = makeImageButton('!cmaster --remove,condition='+key,deleteImage,'Remove Condition','transparent',12);

            if (condition.override) {
                if (state[combatState].config.status.useMessage) {
                    addButton = makeImageButton('!cmaster --add,condition='+key +',duration=?{Duration|'+condition.duration+'},direction=?{Direction|'+condition.direction + '},message=?{Message}',addImage,'Add Condition','transparent',12);
                } else {
                    addButton = makeImageButton('!cmaster --add,condition='+key +',duration=?{Duration|'+condition.duration+'},direction=?{Direction|'+condition.direction + '}',addImage,'Add Condition','transparent',12);
                }
            } else {
                if (state[combatState].config.status.useMessage) {
                    addButton = makeImageButton('!cmaster --add,condition='+key+',duration='+condition.duration+',direction='+condition.direction+',message='+condition.message,addImage,'Add Condition','transparent',12);
                } else {
                    addButton = makeImageButton('!cmaster --add,condition='+key+',duration='+condition.duration+',direction='+condition.direction,addImage,'Add Condition','transparent',12);
                }
            }

            if (condition.favorite) {
                favoriteButton = makeImageButton('!cmaster --config,condition='+key+',key=favorite,value='+!condition.favorite+' --tracker',favoriteImage,'Remove from Favorites','transparent',12);
            } else {
                favoriteButton = makeImageButton('!cmaster --config,condition='+key+',key=favorite,value='+!condition.favorite+' --tracker',allConditionsImage,'Add to Favorites','transparent',12);
            }

            if (rowCount == 1) {
                listContents = '<div>';
                rowCount = 2;
            } else {
                listContents = '<div style="'+styles.background+'">';
                rowCount = 1;
            }
            listContents += getDefaultIcon(condition.iconType,condition.icon,'display:inline-block;margin-right:3px');
            listContents += '<span style="vertical-align:middle">'+condition.name+'</span>';
            if (state[combatState].config.status.userChanges && who != 'gm') {
                listContents += '<span style="float:right;vertical-align:middle">'+addButton+removeButton+'</span>';
            } else {
                listContents += '<span style="float:right;vertical-align:middle">'+addButton+removeButton+favoriteButton+conditionButton+'</span>';
            }
            listContents += '</div>';

            const view = state[combatState].config.status.showConditions;
            if ((view == 'favorites' && condition.favorite) ||
                (view == 'conditions' && condition.type == 'Condition') ||
                (view == 'spells' && condition.type == 'Spell') ||
                view == 'all') {
                listItems.push(listContents);
            }
        }

        let viewButton = makeBigButton('Change View', '!cmaster --show,view,value=?{View|All,all|Conditions,conditions|Spells,spells|Favorites,favorites} --main');

        state[combatState].config.previousPage = 'main';

        if (state[combatState].config.status.access && state[combatState].config.status.access != 'None' && who != 'None' && who != 'gm') {
            let playerIDs = state[combatState].config.status.access.split(',');
            playerIDs.forEach((player) => {
                makeAndSendMenu(contents+makeList(listItems)+viewButton,titleText,player);
            });
        }

        if (who == 'gm' || who == 'None') {
            makeAndSendMenu(contents+makeList(listItems)+viewButton,titleText,'gm');
        } else {
            makeAndSendMenu(makeList(listItems)+viewButton,titleText,who);
        }
    },

    sortObject = function (obj) {
        return Object.keys(obj).sort().reduce(function (result, key) {
            result[key] = obj[key];
            return result;
        }, {});
    },

    sendConfigMenu = function() {
        let helpButton = makeImageButton('!cmaster --help,setup',helpImage,'Help','transparent',18,'white');
        let titleText  = 'Setup'+'<span style="'+styles.buttonRight+'">'+helpButton+'</span>';
        let contents   = '<div style="'+styles.header+'">Combat Setup</div>';

        contents += makeBigButton('Initiative', '!cmaster --show,initiative');
        contents += makeBigButton('Turnorder', '!cmaster --show,turnorder');
        contents += makeBigButton('Timer', '!cmaster --show,timer');
        contents += makeBigButton('Announce', '!cmaster --show,announce');
        contents += makeBigButton('Macro & API', '!cmaster --show,macro');
        contents += '<div style="'+styles.header+'">Status Setup</div>';
        contents += makeBigButton('Status', '!cmaster --show,status');
        contents += makeBigButton('Conditions', '!cmaster --show,conditions');
        contents += makeBigButton('Concentration', '!cmaster --show,concentration');
        contents += makeBigButton('Export', '!cmaster --show,export');
        contents += makeBigButton('Import', '!cmaster --import,config=?{Config}');
        contents += '<div style="'+styles.header+'">Reset CombatMaster</div>';
        contents += makeBigButton('Reset', '!cmaster --reset');
        contents += makeBigButton('Remove Ignores', '!cmaster --ignore');
        contents += makeBigButton('Clear Token Statuses', '!cmaster --clear');
        contents += '<div style="'+styles.header+'">Return</div>';
        contents += makeBigButton('Back', '!cmaster --back,tracker');

        makeAndSendMenu(contents, titleText, 'gm');
    },

    sendInitiativeMenu = function() {
        const banner = makeBanner('initiative','Initiative','setup');
        let listItems  = [];
        let initiative = state[combatState].config.initiative;

        listItems.push(makeTextButton('Roll Initiative', initiative.rollInitiative, '!cmaster --config,initiative,key=rollInitiative,value=?{Initiative|None,None|CombatMaster,CombatMaster|Group-Init,Group-Init} --show,initiative'));
        listItems.push(makeTextButton('Roll Each Round', initiative.rollEachRound, '!cmaster --config,initiative,key=rollEachRound,value='+!initiative.rollEachRound + ' --show,initiative'));

        if (initiative.rollInitiative == 'CombatMaster') {
            listItems.push(makeTextButton('Initiative Attr', initiative.initiativeAttributes, '!cmaster --config,initiative,key=initiativeAttributes,value=?{Attribute (comma separated)|'+initiative.initiativeAttributes+'} --show,initiative'));
            listItems.push(makeTextButton('Initiative Die', 'd' + initiative.initiativeDie, '!cmaster --config,initiative,key=initiativeDie,value=?{Die (without the d)|'+initiative.initiativeDie+'} --show,initiative'));
            listItems.push(makeTextButton('Show Initiative in Chat', initiative.showInitiative, '!cmaster --config,initiative,key=showInitiative,value='+!initiative.showInitiative + ' --show,initiative'));
            listItems.push('<div style="font-size:10px;clear:both">D&amp;D 2024 and 2014 OGL: initiative_bonus. Add init_tiebreaker on 2024 for tie breaks.</div>');
        }

        if (initiative.rollInitiative == 'Group-Init') {
            listItems.push(makeTextButton('Target Tokens', initiative.apiTargetTokens, '!cmaster --config,initiative,key=apiTargetTokens,value=?{Target Tokens|} --show,initiative'));
        }

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendTurnorderMenu = function() {
        const banner = makeBanner('turnorder','Turnorder','setup');
        let listItems = [];
        let turnorder = state[combatState].config.turnorder;

        if (!verifyInstalls(turnorder.nextMarkerType) || !verifyInstalls(turnorder.markerType)) {
            return;
        }

        listItems.push(makeTextButton('Sort Turnorder',turnorder.sortTurnOrder, '!cmaster --config,turnorder,key=sortTurnOrder,value='+!turnorder.sortTurnOrder + ' --show,turnorder'));
        listItems.push(makeTextButton('Center Map on Token', turnorder.centerToken, '!cmaster --config,turnorder,key=centerToken,value='+!turnorder.centerToken + ' --show,turnorder'));
        listItems.push(makeTextButton('Use Marker',turnorder.useMarker, '!cmaster --config,turnorder,key=useMarker,value='+!turnorder.useMarker + ' --show,turnorder'));
        listItems.push(makeTextButton('Marker Type',turnorder.markerType, '!cmaster --config,turnorder,key=markerType,value=?{Marker Type|External URL,External URL|Token Marker,Token Marker|Token Condition,Token Condition} --show,turnorder'));

        if (turnorder.markerType == 'External URL') {
            listItems.push(makeTextButton('Marker', '<img src="'+turnorder.externalMarkerURL+'" width="20px" height="20px" />', '!cmaster --config,turnorder,key=externalMarkerURL,value=?{Image Url} --show,turnorder'));
        } else if (turnorder.markerType == 'Token Marker') {
            listItems.push(makeTextButton('Marker Name',turnorder.tokenMarkerName, '!cmaster --config,turnorder,key=tokenMarkerName,value=?{Marker Name|} --show,turnorder'));
            listItems.push(getDefaultIcon('Token Marker',turnorder.tokenMarkerName));
        }

        listItems.push(makeTextButton('Use Next Marker',turnorder.nextMarkerType, '!cmaster --config,turnorder,key=nextMarkerType,value=?{Next Marker Type|None,None|External URL,External URL|Token Marker,Token Marker|Token Condition,Token Condition} --show,turnorder'));

        if (turnorder.nextMarkerType == 'External URL') {
            listItems.push(makeTextButton('Next Marker', '<img src="'+turnorder.nextExternalMarkerURL+'" width="20px" height="20px" />', '!cmaster --config,turnorder,key=nextExternalMarkerURL,value=?{Image Url} --show,turnorder'));
        } else if (turnorder.nextMarkerType == 'Token Marker') {
            listItems.push(makeTextButton('Next Marker Name',turnorder.nextTokenMarkerName, '!cmaster --config,turnorder,key=nextTokenMarkerName,value=?{Next Marker Name|} --show,turnorder'));
            listItems.push(getDefaultIcon('Token Marker', turnorder.nextTokenMarkerName));
        }
        listItems.push(makeTextButton('Marker Size',turnorder.markerSize, '!cmaster --config,turnorder,key=markerSize,value=?{Marker Size (1.35 default)|'+turnorder.markerSize+'} --show,turnorder'));
        listItems.push(makeTextButton('Animate Marker',turnorder.animateMarker, '!cmaster --config,turnorder,key=animateMarker,value='+!turnorder.animateMarker + ' --show,turnorder'));
        listItems.push(makeTextButton('Animation Angle Step',turnorder.animateMarkerDegree, '!cmaster --config,turnorder,key=animateMarkerDegree,value=?{Degrees to rotate every tick (15 default)|'+turnorder.animateMarkerDegree+'} --show,turnorder'));
        listItems.push(makeTextButton('Animation Angle Wait',turnorder.animateMarkerWait, '!cmaster --config,turnorder,key=animateMarkerWait,value=?{milliseconds per tick (250 default)|'+turnorder.animateMarkerWait+'} --show,turnorder'));
        listItems.push('<div style="margin-top:3px"><i><b>Beginning of Each Round</b></i></div>');
        listItems.push(makeTextButton('API',turnorder.roundAPI, '!cmaster --config,turnorder,key=roundAPI,value={{?{API Command|}}} --show,turnorder'));
        listItems.push(makeTextButton('Roll20AM',turnorder.roundRoll20AM, '!cmaster --config,turnorder,key=roundRoll20AM,value={{?{Roll20AM Command|}}} --show,turnorder'));
        listItems.push(makeTextButton('FX',turnorder.roundFX, '!cmaster --config,turnorder,key=roundFX,value=?{FX Command|} --show,turnorder'));
        listItems.push(makeTextButton('Characters Macro',turnorder.characterRoundMacro, '!cmaster --config,turnorder,key=characterRoundMacro,value=?{Macro Name|} --show,turnorder'));
        listItems.push(makeTextButton('All Tokens Macro',turnorder.allRoundMacro, '!cmaster --config,turnorder,key=allRoundMacro,value=?{Macro Name|} --show,turnorder'));

        listItems.push('<div style="margin-top:3px"><i><b>Beginning of Each Turn</b></i></div>');
        listItems.push(makeTextButton('API',turnorder.turnAPI, '!cmaster --config,turnorder,key=turnAPI,value={{?{API Command|}}} --show,turnorder'));
        listItems.push(makeTextButton('Roll20AM',turnorder.turnRoll20AM, '!cmaster --config,turnorder,key=turnRoll20AM,value={{?{Roll20AM Command|}}} --show,turnorder'));
        listItems.push(makeTextButton('FX',turnorder.turnFX, '!cmaster --config,turnorder,key=turnFX,value=?{FX Command|} --show,turnorder'));
        listItems.push(makeTextButton('Macro',turnorder.turnMacro, '!cmaster --config,turnorder,key=turnMacro,value=?{Macro Name|} --show,turnorder'));

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendTimerMenu = function() {
        const banner = makeBanner('timer','Timer','setup');
        let listItems = [];
        let timer = state[combatState].config.timer;

        listItems.push(makeTextButton('Turn Timer', timer.useTimer, '!cmaster --config,timer,key=useTimer,value='+!timer.useTimer + ' --show,timer'));

        if (timer.useTimer) {
            listItems.push(makeTextButton('Time', timer.time, '!cmaster --config,timer,key=time,value=?{Time|'+timer.time+'} --show,timer'));
            listItems.push(makeTextButton('Skip Turn', timer.skipTurn, '!cmaster --config,timer,key=skipTurn,value='+!timer.skipTurn + ' --show,timer'));
            listItems.push(makeTextButton('Send to Chat', timer.sendTimerToChat, '!cmaster --config,timer,key=sendTimerToChat,value='+!timer.sendTimerToChat + ' --show,timer'));
            listItems.push(makeTextButton('Show on Token', timer.showTokenTimer, '!cmaster --config,timer,key=showTokenTimer,value='+!timer.showTokenTimer + ' --show,timer'));
            listItems.push(makeTextButton('Token Font', timer.timerFont, '!cmaster --config,timer,key=timerFont,value=?{Font|Arial|Patrick Hand|Contrail|Light|Candal} --show,timer'));
            listItems.push(makeTextButton('Token Font Size',timer.timerFontSize, '!cmaster --config,timer,key=timerFontSize,value=?{Font Size|'+timer.timerFontSize+'} --show,timer'));
        }

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendAnnounceMenu = function() {
        const banner = makeBanner('announcements','Announcements','setup');
        let announcements = state[combatState].config.announcements;

        let listItems = [
            makeTextButton('Announce Rounds', announcements.announceRound, '!cmaster --config,announcements,key=announceRound,value='+!announcements.announceRound + ' --show,announce'),
            makeTextButton('Announce Turns', announcements.announceTurn, '!cmaster --config,announcements,key=announceTurn,value='+!announcements.announceTurn + ' --show,announce'),
            makeTextButton('Whisper GM Only', announcements.whisperToGM, '!cmaster --config,announcements,key=whisperToGM,value='+!announcements.whisperToGM + ' --show,announce'),
            makeTextButton('Shorten Long Names', announcements.handleLongName, '!cmaster --config,announcements,key=handleLongName,value='+!announcements.handleLongName + ' --show,announce'),
            makeTextButton('Show NPC Conditions', announcements.showNPCTurns, '!cmaster --config,announcements,key=showNPCTurns,value='+!announcements.showNPCTurns + ' --show,announce'),
        ];

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendMacroMenu = function() {
        const banner = makeBanner('macro','Macro & API','setup');
        let addButton = makeBigButton('Add Substitution', '!cmaster --new,macro,type=?{Type|CharID,CharID|CharName,CharName|TokenID,TokenID|PlayerID,PlayerID},action=?{Action|}');
        let substitutions = state[combatState].config.macro.substitutions;
        let listItems = [];

        substitutions.forEach((substitution) => {
            let deleteButton = makeImageButton('!cmaster --delete,macro,action='+substitution.action,deleteImage,'Delete Substitution','transparent',12);
            let listContents  = '<div>';
            listContents += '<span style="vertical-align:middle">'+substitution.type+ ': '+substitution.action+'</span>';
            listContents += '<span style="float:right;vertical-align:middle">'+deleteButton+'</span>';
            listContents += '</div>';
            listItems.push(listContents);
        });

        makeAndSendMenu(addButton+makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendStatusMenu = function() {
        const banner = makeBanner('status','Status','setup');
        let status = state[combatState].config.status;

        let listItems = [
            makeTextButton('Whisper GM Only', status.sendOnlyToGM, '!cmaster --config,status,key=sendOnlyToGM,value='+!status.sendOnlyToGM+' --show,status'),
            makeTextButton('Player Allowed Changes', status.userChanges, '!cmaster --config,status,key=userChanges,value='+!status.userChanges+' --show,status'),
            makeTextButton('Send Changes to Chat', status.sendConditions, '!cmaster --config,status,key=sendConditions,value='+!status.sendConditions+' --show,status'),
            makeTextButton('Clear Conditions on Close', status.clearConditions, '!cmaster --config,status,key=clearConditions,value='+!status.clearConditions + ' --show,status'),
            makeTextButton('Use Messages', status.useMessage, '!cmaster --config,status,key=useMessage,value='+!status.useMessage + ' --show,status'),
            makeTextButton('Auto Add Spells', status.autoAddSpells, '!cmaster --config,status,key=autoAddSpells,value='+!status.autoAddSpells+' --show,status'),
        ];

        if (status.autoAddSpells) {
            listItems.push(makeTextButton('Sheet', status.sheet, '!cmaster --config,status,key=sheet,value=?{Sheet|Auto (2014 and 2024),Auto|D&D 2024 by Roll20,DND2024|D&D5E OGL 2014,OGL|D&D5E Shaped,Shaped|PF2,PF2} --show,status'));
        }
        listItems.push(makeTextButton('Log Raw Rolls (debug)', status.logRolls, '!cmaster --config,status,key=logRolls,value='+!status.logRolls+' --show,status'));

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendConcentrationMenu = function() {
        const banner = makeBanner('concentration','Concentration','setup');
        let concentration = state[combatState].config.concentration;
        let listItems = [];

        listItems.push(makeTextButton('Use Concentration', concentration.useConcentration, '!cmaster --config,concentration,key=useConcentration,value='+!concentration.useConcentration + ' --show,concentration'));

        if (concentration.useConcentration) {
            listItems.push(makeTextButton('Add Marker on Cast', concentration.autoAdd, '!cmaster --config,concentration,key=autoAdd,value='+!concentration.autoAdd+' --show,concentration'));
            listItems.push(makeTextButton('Wound Bar', concentration.woundBar, '!cmaster --config,concentration,key=woundBar,value=?{Wound Bar|Bar1,bar1|Bar2,bar2|Bar3,bar3} --show,concentration'));
            listItems.push(makeTextButton('Notify', concentration.notify, '!cmaster --config,concentration,key=notify,value=?{Notify|Everyone,Everyone|Character,Character|GM,GM} --show,concentration'));
            listItems.push(makeTextButton('Roll Save Automatically', concentration.autoRoll, '!cmaster --config,concentration,key=autoRoll,value='+!concentration.autoRoll+' --show,concentration'));
            listItems.push(makeTextButton('Save Bonus Attr', concentration.attribute, '!cmaster --config,concentration,key=attribute,value=?{Save bonus attribute (None to skip)|'+concentration.attribute+'} --show,concentration'));
            listItems.push(makeTextButton('End on Incapacitated', concentration.breakOnIncapacitated, '!cmaster --config,concentration,key=breakOnIncapacitated,value='+!concentration.breakOnIncapacitated+' --show,concentration'));
        }

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendConditionsMenu = function(message) {
        let key, condition, conditionButton, rowCount=1;
        let backButton = makeBigButton('Back', '!cmaster --back,setup');
        let addButton  = makeBigButton('Add Condition', '!cmaster --new,condition=?{Name}');
        let helpButton = makeImageButton('!cmaster --help,conditions',helpImage,'Help','transparent',18,'white');
        let titleText  = 'Conditions Setup'+'<span style="'+styles.buttonRight+'">'+helpButton+'</span>';
        let listItems  = [];
        let listContents;
        let icons = [];
        let warned = false;

        for (key in sortObject(state[combatState].config.conditions)) {
            condition = getConditionByKey(key);
            if (!verifyInstalls(condition.iconType)) {
                return;
            }
            conditionButton = makeImageButton('!cmaster --show,condition=' + key,backImage,'Edit Condition','transparent',12);

            if (rowCount == 1) {
                listContents = '<div>';
                rowCount = 2;
            } else {
                listContents = '<div style="'+styles.background+'">';
                rowCount = 1;
            }

            listContents += getDefaultIcon(condition.iconType,condition.icon,'display:inline-block;margin-right:3px');
            listContents += '<span style="vertical-align:middle">'+condition.name+'</span>';
            listContents += '<span style="float:right;vertical-align:middle">'+conditionButton+'</span>';
            listContents += '</div>';

            listItems.push(listContents);

            if (!warned && icons.includes(condition.icon)) {
                message = (message || '') + '<br>Multiple conditions use the same icon';
                warned = true;
            }
            icons.push(condition.icon);
        }

        message = (message) ? '<p style="color: red">'+message+'</p>' : '';
        let contents = message + makeList(listItems, backButton, addButton);

        state[combatState].config.previousPage = 'conditions';
        makeAndSendMenu(contents,titleText,'gm');
    },

    sendConditionMenu = function(key) {
        let condition  = state[combatState].config.conditions[key];
        if (!condition) {
            sendConditionsMenu('The condition `'+key+'` does not exist.');
            return;
        }
        let listItems  = [];
        let helpButton = makeImageButton('!cmaster --help,condition',helpImage,'Help','transparent',18,'white');
        let titleText  = 'Condition Setup'+'<span style="'+styles.buttonRight+'">'+helpButton+'</span>';

        if (typeof condition.description == 'undefined') {
            condition.description = ' ';
        }

        let removeButton        = makeBigButton('Delete Condition', '!cmaster --delete,condition='+key+',confirm=?{Are you sure?|Yes,yes|No,no}');
        let descriptionButton   = makeBigButton('Edit Description', '!cmaster --config,condition='+key+',key=description,value={{?{Description|'+stripHtml(condition.description).replace(/[|{}]/g,'')+'}}} --show,condition='+key);
        let backButton          = makeBigButton('Back', '!cmaster --back');

        listItems.push(makeTextButton('Name', condition.name, '!cmaster --config,condition='+key+',key=name,value=?{Name}'));
        listItems.push(makeTextButton('Type', condition.type, '!cmaster --config,condition='+key+',key=type,value=?{Type|Condition,Condition|Spell,Spell} --show,condition='+key));
        listItems.push(makeTextButton('Icon Type', condition.iconType, '!cmaster --config,condition='+key+',key=iconType,value=?{Icon Type|Combat Master,Combat Master|Token Marker,Token Marker|Token Condition,Token Condition} --show,condition='+key));

        if (!verifyInstalls(condition.iconType)) {
            return;
        }

        if (condition.iconType == 'Token Condition') {
            listItems.push(makeTextButton('Icon', condition.icon, '!cmaster --config,condition='+key+',key=icon,value=?{Token Condition|} --show,condition='+key));
        } else {
            listItems.push(makeTextButton('Icon', getDefaultIcon(condition.iconType,condition.icon), '!cmaster --config,condition='+key+',key=icon,value='+buildMarkerDropdown(condition.iconType)+' --show,condition='+key));
        }

        listItems.push(makeTextButton('Duration', condition.duration, '!cmaster --config,condition='+key+',key=duration,value=?{Duration|'+condition.duration+'} --show,condition='+key));
        listItems.push(makeTextButton('Direction', condition.direction, '!cmaster --config,condition='+key+',key=direction,value=?{Direction|'+condition.direction+'} --show,condition='+key));
        listItems.push(makeTextButton('Override', condition.override, '!cmaster --config,condition='+key+',key=override,value='+!condition.override+' --show,condition='+key));
        listItems.push(makeTextButton('Favorites', condition.favorite, '!cmaster --config,condition='+key+',key=favorite,value='+!condition.favorite+' --show,condition='+key));
        listItems.push(makeTextButton('Message', condition.message, '!cmaster --config,condition='+key+',key=message,value={{?{Message}}} --show,condition='+key));
        listItems.push(makeTextButton('Targeted', condition.targeted, '!cmaster --config,condition='+key+',key=targeted,value='+!condition.targeted+' --show,condition='+key));
        if (condition.targeted) {
            listItems.push(makeTextButton('Targeted API', condition.targetedAPI, '!cmaster --config,condition='+key+',key=targetedAPI,value=?{Targeted API|Caster&Targets,casterTargets|Targets(Only),targets} --show,condition='+key));
        }
        listItems.push(makeTextButton('Concentration', condition.concentration, '!cmaster --config,condition='+key+',key=concentration,value='+!condition.concentration+' --show,condition='+key));
        listItems.push('<div style="margin-top:3px"><i><b>Adding Condition</b></i></div>');
        listItems.push(makeBigButton('Add APIs', '!cmaster --show,condition='+key+',addAPI'));
        listItems.push('<div style="margin-top:3px"><i><b>Removing Condition</b></i></div>');
        listItems.push(makeBigButton('Remove APIs', '!cmaster --show,condition='+key+',remAPI'));

        let contents = makeList(listItems)+'<hr>'+descriptionButton+'<b>Description:</b>'+condition.description+removeButton+'<hr>'+backButton;
        makeAndSendMenu(contents,titleText,'gm');
    },

    sendConditionAddAPIMenu = function (key) {
        const banner = makeBanner('addAPI','Add API','condition='+key);
        let condition = state[combatState].config.conditions[key];
        if (!condition) {
            return;
        }

        let listItems = [
            makeTextButton('API', condition.addAPI, '!cmaster --config,condition='+key+',key=addAPI,value=?{API Command|} --show,condition='+key),
            makeTextButton('Roll20AM', condition.addRoll20AM, '!cmaster --config,condition='+key+',key=addRoll20AM,value=?{Roll20AM Command|} --show,condition='+key),
            makeTextButton('FX', condition.addFX, '!cmaster --config,condition='+key+',key=addFX,value=?{FX|} --show,condition='+key),
            makeTextButton('Macro', condition.addMacro, '!cmaster --config,condition='+key+',key=addMacro,value=?{Macro|} --show,condition='+key),
            makeTextButton('Persistent Macro', condition.addPersistentMacro, '!cmaster --config,condition='+key+',key=addPersistentMacro,value='+!condition.addPersistentMacro+' --show,condition='+key)
        ];

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    sendConditionRemAPIMenu = function (key) {
        const banner = makeBanner('remAPI','Remove API','condition='+key);
        let condition = state[combatState].config.conditions[key];
        if (!condition) {
            return;
        }

        let listItems = [
            makeTextButton('API', condition.remAPI, '!cmaster --config,condition='+key+',key=remAPI,value=?{API Command|} --show,condition='+key),
            makeTextButton('Roll20AM', condition.remRoll20AM, '!cmaster --config,condition='+key+',key=remRoll20AM,value=?{Roll20AM Command|} --show,condition='+key),
            makeTextButton('FX', condition.remFX, '!cmaster --config,condition='+key+',key=remFX,value=?{FX|} --show,condition='+key),
            makeTextButton('Macro', condition.remMacro, '!cmaster --config,condition='+key+',key=remMacro,value=?{Macro|} --show,condition='+key)
        ];

        makeAndSendMenu(makeList(listItems,banner.backButton),banner.titleText,'gm');
    },

    buildMarkerDropdown = function (iconType) {
        let markerDropdown = '?{Marker';

        if (iconType == 'Combat Master') {
            ctMarkers.forEach((marker) => {
                markerDropdown += '|'+ucFirst(marker).replace(/-/g, ' ')+','+marker;
            });
        } else if (iconType == 'Token Marker') {
            if (markers.length == 0) {
                markers = getTokenMarkers();
            }
            markers.forEach((marker) => {
                markerDropdown += '|'+marker.name+','+marker.name;
            });
        }
        markerDropdown += '}';

        return markerDropdown;
    },

    showConditions = function (selectedTokens) {
        if (selectedTokens) {
            selectedTokens.forEach(token => {
                if (token._type == 'graphic' && !isMarkerToken(token._id)) {
                    announcePlayer(getObj('graphic', token._id), false, false, true);
                }
            });
        }
    },

    importCombatMaster = function (config) {
        let json;
        let backButton = makeBigButton('Back', '!cmaster --back,setup');

        try {
            json = JSON.parse(String(config).replace(/^config=/,''));
        } catch (e) {
            makeAndSendMenu('Import failed: the text is not valid JSON.' + backButton, 'Import Setup', 'gm');
            return;
        }

        if (['cmaster','cm'].includes(json.command)) {
            state[combatState].config = json;
            state[combatState].conditions = [];
            setDefaults();
            makeAndSendMenu('Current Combat Master detected and imported.' + backButton, 'Import Setup', 'gm');
        } else if (json.config && json.config.command == 'condition') {
            state[combatState].config.conditions = json.conditions;
            setDefaults();
            makeAndSendMenu('Prior Combat Tracker detected and conditions were imported.' + backButton, 'Import Setup', 'gm');
        } else {
            makeAndSendMenu('Import failed: unknown configuration format.' + backButton, 'Import Setup', 'gm');
        }
    },

    exportConditions = function () {
        const banner = makeBanner('export','Export CM','setup');
        makeAndSendMenu('<p>Copy the entire content above and save it on your pc.</p><pre>'+HE(JSON.stringify(state[combatState].config))+'</pre><div>'+banner.backButton+'</div>', banner.titleText, 'gm');
    },

    targetedCondition = function (id, key) {
        let condition = getConditionByKey(key);
        let title     = 'Select Targets';
        let addButton = makeImageButton('!cmaster --add,target,id='+id+',condition='+key,tagImage,'Targeted Icons','transparent',18,'white');
        title        += '<div style="'+styles.buttonRight+'">'+addButton+'</div>';
        let contents  = 'Select target tokens to assign <b>' + condition.name + '</b> and hit the button above when ready';
        makeAndSendMenu(contents,title,'gm');
    },

    targetedSpell = function (key) {
        let condition = getConditionByKey(key);
        let title     = 'Select Targets';
        let addButton = makeImageButton(`!cmaster --add,condition=${key},duration=${condition.duration},direction=${condition.direction}`,tagImage,'Spell Targets','transparent',18,'white');
        title        += '<div style="'+styles.buttonRight+'">'+addButton+'</div>';
        let contents  = 'Select the target tokens to assign <b>' + condition.name + '</b> and hit the button above to apply';
        makeAndSendMenu(contents,title,'gm');
    },

    targetedCaster = function (key,duration,direction,message) {
        let title     = 'Select Caster';
        let addButton = makeImageButton(`!cmaster --add,condition=${key},duration=${duration},direction=${direction},message=${message}`,tagImage,'Spell Caster','transparent',18,'white');
        title        += '<div style="'+styles.buttonRight+'">'+addButton+'</div>';
        let contents  = 'Select the caster to assign concentration and hit the button above when ready';
        makeAndSendMenu(contents,title,'gm');
    },

//*************************************************************************************************************
//SESSION STATE MAINTENANCE
//*************************************************************************************************************
    editCombatState = function (cmdDetails) {
        const details    = cmdDetails.details;
        const config     = state[combatState].config;
        const numberKeys = ['initiativeDie','markerSize','animateMarkerDegree','animateMarkerWait','time','timerFontSize'];

        if (numberKeys.includes(details.key) && !details.condition) {
            const number = parseFloat(details.value);
            if (!Number.isFinite(number) || number <= 0) {
                makeAndSendMenu('"' + HE(String(details.value)) + '" is not a valid number.', 'Setup', 'gm');
                return;
            }
            details.value = (details.key === 'markerSize') ? number : Math.round(number);
        }
        if (details.key === 'woundBar') {
            details.value = String(details.value).toLowerCase();
        }

        if (details.initiative) {
            config.initiative[details.key] = details.value;
        } else if (details.timer) {
            config.timer[details.key] = details.value;
        } else if (details.turnorder) {
            config.turnorder[details.key] = details.value;
        } else if (details.announcements) {
            config.announcements[details.key] = details.value;
        } else if (details.status) {
            config.status[details.key] = details.value;
        } else if (details.concentration) {
            config.concentration[details.key] = details.value;
            if (details.key === 'useConcentration' && details.value === true && !config.conditions.concentration) {
                config.conditions.concentration = getDefaultConditions().concentration;
            }
        } else if (details.condition) {
            const oldKey = details.condition;
            if (!config.conditions[oldKey]) {
                makeAndSendMenu('That condition does not exist anymore.', 'Setup', 'gm');
                return;
            }
            if (details.key === 'name') {
                const newName = String(details.value).trim();
                const newKey  = newName.toLowerCase();
                if (!newName || /[,|{}]/.test(newName)) {
                    makeAndSendMenu('Condition names cannot be empty or contain , | { }', 'Setup', 'gm');
                    sendConditionMenu(oldKey);
                    return;
                }
                if (newKey !== oldKey) {
                    if (config.conditions[newKey]) {
                        makeAndSendMenu('A condition called <b>' + HE(newName) + '</b> already exists.', 'Setup', 'gm');
                        sendConditionMenu(oldKey);
                        return;
                    }
                    config.conditions[newKey] = config.conditions[oldKey];
                    delete config.conditions[oldKey];
                }
                config.conditions[newKey].key  = newKey;
                config.conditions[newKey].name = newName;
                sendConditionMenu(newKey);
            } else {
                if (['duration','direction'].includes(details.key)) {
                    const n = parseInt(details.value);
                    details.value = Number.isFinite(n) ? n : 0;
                }
                config.conditions[oldKey][details.key] = details.value;
            }
        }
    },

    editShowState = function (value) {
        state[combatState].config.status.showConditions = value;
    },

//*************************************************************************************************************
//CONDITIONS
//*************************************************************************************************************
    newCondition = function (name, type='Condition', concentration=false, description='None') {
        if (!name) {
            sendConditionsMenu('You didn\'t give a condition name, eg. <i>!cmaster --new,condition=Prone</i>.');
        } else if (state[combatState].config.conditions[name.toLowerCase()]) {
            sendConditionsMenu('The condition `'+name+'` already exists.');
        } else {
            state[combatState].config.conditions[name.toLowerCase()] = makeDefaultCondition(
                name.toLowerCase(), name, type, 'red', description,
                { concentration: concentration, direction: 0, override: false }
            );
            sendConditionMenu(name.toLowerCase());
        }
    },

    deleteCondition = function (key, confirm) {
        if (confirm !== 'yes') {
            if (key && state[combatState].config.conditions[key]) {
                sendConditionMenu(key);
            } else {
                sendConditionsMenu();
            }
            return;
        }
        if (!key) {
            sendConditionsMenu('You didn\'t give a condition name, eg. <i>!cmaster --delete,condition=Prone</i>.');
        } else if (!state[combatState].config.conditions[key]) {
            sendConditionsMenu('The condition `'+key+'` doesn\'t exist.');
        } else {
            delete state[combatState].config.conditions[key];
            sendConditionsMenu('The condition `'+key+'` is removed.');
        }
    },

    getConditionByMarker = function (marker) {
        const base = String(marker || '').split('@')[0];
        if (!base) {
            return false;
        }
        const conditions = state[combatState].config.conditions;
        for (let key in conditions) {
            const icon = conditions[key].icon;
            if (icon && (base === icon || base.split('::')[0] === icon)) {
                return conditions[key];
            }
        }
        return false;
    },

    hasCondition = function (tokenId, key) {
        return state[combatState].conditions.some(c => c.id == tokenId && c.key == key);
    },

    getConditionByKey = function(key) {
        return state[combatState].config.conditions[key];
    },

    getConditions = function () {
        return state[combatState].config.conditions;
    },

    verifyCondition = function(token,key) {
        let condition = getConditionByKey(key);

        if (!condition) {
            return true;
        }
        if (typeof condition.direction == 'undefined' || typeof condition.duration == 'undefined') {
            makeAndSendMenu('The condition you are trying to use has not be setup yet', '', 'gm');
            return false;
        }
        if (!key) {
            makeAndSendMenu('No condition name was given.', '', 'gm');
            return false;
        }
        if (!token || !token.length) {
            makeAndSendMenu('No tokens were selected.', '', 'gm');
            return false;
        }
        if (isMarkerToken(token)) {
            return false;
        }
        return true;
    },

    addCondition = function(cmdDetails,selectedTokens) {
        if (selectedTokens) {
            selectedTokens.forEach(token => {
                if (token._type == 'graphic') {
                    addConditionToToken(getObj(token._type, token._id),cmdDetails.details.condition,cmdDetails.details.duration,cmdDetails.details.direction,cmdDetails.details.message);
                }
            });
        } else {
            makeAndSendMenu('No tokens were selected.', '', 'gm');
        }
    },

    removeCondition = function (cmdDetails,selectedTokens) {
        if (cmdDetails.details.id) {
            removeConditionFromToken(getObj('graphic', cmdDetails.details.id), cmdDetails.details.condition, true);
        } else if (selectedTokens) {
            selectedTokens.forEach(token => {
                if (token._type == 'graphic') {
                    removeConditionFromToken(getObj(token._type, token._id),cmdDetails.details.condition, true);
                }
            });
        }
    },

    addConditionToToken = function(tokenObj,key,duration,direction,message) {
        let defaultCondition = getConditionByKey(key);
        let newCondition = {};

        if (!tokenObj) {
            return;
        }

        if (debug) {
            log('Add Condition To Token');
        }

        if (!verifyCondition(tokenObj.get("_id"), key)) {
            return;
        }

        let remove = removeConditionFromToken(tokenObj, key, false);

        newCondition.id               = tokenObj.get("_id");
        newCondition.key              = key;
        newCondition.target           = remove.targets || [];
        newCondition.tokenConditionID = null;

        if (defaultCondition) {
            newCondition.name               = defaultCondition.name;
            newCondition.icon               = defaultCondition.icon;
            newCondition.iconType           = defaultCondition.iconType;
            newCondition.addMacro           = defaultCondition.addMacro;
            newCondition.addPersistentMacro = defaultCondition.addPersistentMacro;
            newCondition.concentration      = defaultCondition.concentration;
            newCondition.override           = defaultCondition.override;
            newCondition.message            = defaultCondition.message;
            newCondition.type               = defaultCondition.type;
            newCondition.targeted           = defaultCondition.targeted;
            newCondition.targetedAPI        = defaultCondition.targetedAPI;
        } else {
            newCondition.name               = key;
            newCondition.icon               = null;
            newCondition.iconType           = null;
            newCondition.addMacro           = null;
            newCondition.addPersistentMacro = null;
            newCondition.concentration      = false;
            newCondition.override           = false;
            newCondition.message            = null;
            newCondition.type               = 'Condition';
            newCondition.targeted           = false;
            newCondition.targetedAPI        = null;
        }

        if (newCondition.iconType == 'Token Condition') {
            let characterObj = findObjs({name: newCondition.icon, _type: 'character'})[0];
            if (!characterObj) {
                makeAndSendMenu('Token Condition character <b>' + HE(String(newCondition.icon)) + '</b> was not found.', '', 'gm');
            } else {
                characterObj.get("defaulttoken", function(defaulttoken) {
                    if (!defaulttoken) {
                        makeAndSendMenu('Character <b>' + HE(characterObj.get('name')) + '</b> has no default token.', '', 'gm');
                        return;
                    }
                    let newToken;
                    try {
                        newToken = JSON.parse(defaulttoken);
                    } catch (e) {
                        reportError('Token Condition', e);
                        return;
                    }
                    let condition = createObj('graphic', {
                        subtype:'token',
                        name: newToken.name,
                        imgsrc: getCleanImgsrc(newToken.imgsrc),
                        pageid: tokenObj.get('pageid'),
                        represents: characterObj.id,
                        layer: tokenObj.get('layer'),
                        left: tokenObj.get('left'),
                        top: tokenObj.get('top'),
                        width: tokenObj.get('width'),
                        height: tokenObj.get('height')
                    });
                    if (!condition) {
                        makeAndSendMenu('Could not create the Token Condition token. Its image must be in your Roll20 library.', '', 'gm');
                        return;
                    }
                    let result = TokenCondition.AttachConditionToToken(condition.id,tokenObj.id);
                    if (result.success) {
                        newCondition.tokenConditionID = condition.id;
                    } else {
                        log(`Attach failed. Message: ${result.reason}`);
                    }
                });
            }
        }

        const parsedDuration  = parseInt(duration);
        const parsedDirection = parseInt(direction);

        newCondition.duration  = Number.isFinite(parsedDuration) ? parsedDuration : (defaultCondition ? parseInt(defaultCondition.duration) || 1 : 1);
        newCondition.direction = Number.isFinite(parsedDirection) ? parsedDirection : (defaultCondition ? parseInt(defaultCondition.direction) || 0 : 0);
        newCondition.message   = (!message && defaultCondition) ? defaultCondition.message : message;

        // Stored right away (the old 500 ms delay could lose conditions when turns moved quickly)
        state[combatState].conditions.push(newCondition);

        // 2024 rules: becoming Incapacitated ends Concentration
        const concentrationConfig = state[combatState].config.concentration;
        if (concentrationConfig.useConcentration && concentrationConfig.breakOnIncapacitated &&
            incapacitatingConditions.includes(key) && hasCondition(newCondition.id, 'concentration')) {
            removeConditionFromToken(tokenObj, 'concentration', true);
            makeAndSendMenu('<b>' + HE(tokenObj.get('name') || 'Token') + '</b> is ' + HE(newCondition.name) + ' and loses Concentration.', 'Concentration', 'gm');
        }

        addMarker(tokenObj, newCondition.iconType, newCondition.icon, newCondition.duration, newCondition.direction, newCondition.key);

        if (newCondition.target.length > 0) {
            newCondition.target.forEach((targetID) => {
                if (newCondition.key != 'dead') {
                    const targetObj = getObj('graphic', targetID);
                    if (targetObj) {
                        addMarker(targetObj,newCondition.iconType,newCondition.icon,newCondition.duration, newCondition.direction, newCondition.key);
                    }
                }
            });
        }

        if (!remove.removed) {
            if (state[combatState].config.status.sendConditions && defaultCondition) {
                sendConditionToChat(newCondition.key);
            }
            if (newCondition.targeted) {
                targetedCondition(newCondition.id, key);
            }
            if (newCondition.concentration == true && newCondition.override == true) {
                targetedCaster('concentration',newCondition.duration,newCondition.direction,'Concentrating on ' + newCondition.name);
            }
            if (!newCondition.targeted || (newCondition.targeted && newCondition.targetedAPI == 'casterTargets')) {
                doAddConditionCalls(tokenObj,key);
            }
        }
    },

    getCleanImgsrc = function (imgsrc) {
        if (!imgsrc) {
            return;
        }
        let parts = String(imgsrc).match(/(.*\/images\/.*)(thumb|med|original|max)([^?]*)(\?[^?]+)?$/);
        if (parts) {
            return parts[1]+'thumb'+parts[3]+(parts[4]?parts[4]:`?${Math.round(Math.random()*9999999)}`);
        }
        return;
    },

    removeConditionFromToken = function(tokenObj,key,removeAPI) {
        if (!tokenObj) {
            return { removed: false, targets: [] };
        }

        const tokenID = tokenObj.get('_id');
        let removed = false;
        let targets = [];

        const matches = state[combatState].conditions.filter(c => c.id == tokenID && c.key == key);

        matches.forEach((condition) => {
            if (condition.target && condition.target.length > 0) {
                targets = condition.target;
                targets.forEach((targetID) => {
                    if (condition.iconType == 'Token Condition') {
                        removeTokenCondition(condition.tokenConditionID);
                    } else {
                        const targetObj = getObj('graphic', targetID);
                        if (targetObj) {
                            removeMarker(targetObj, condition.iconType, condition.icon);
                            if (condition.targeted && removeAPI) {
                                doRemoveConditionCalls(targetObj,condition.key);
                            }
                        }
                    }
                });
            }

            if (condition.iconType == 'Token Condition') {
                removeTokenCondition(condition.tokenConditionID);
            } else {
                removeMarker(tokenObj, condition.iconType, condition.icon);
            }
            if (condition.concentration == true) {
                let concentration = getConditionByKey('concentration');
                if (concentration) {
                    removeMarker(tokenObj, concentration.iconType, concentration.icon);
                }
            }
            if (!condition.targeted || (condition.targeted && condition.targetedAPI == 'casterTargets')) {
                if (removeAPI) {
                    doRemoveConditionCalls(tokenObj,condition.key);
                }
            }
            removed = true;
        });

        if (removed) {
            state[combatState].conditions = state[combatState].conditions.filter(c => !(c.id == tokenID && c.key == key));
        }

        return {
            removed,
            targets
        };
    },

    removeTokenCondition = function (id) {
        if (!id) {
            return;
        }
        let conditionToken = getObj('graphic', id);
        if (conditionToken) {
            conditionToken.remove();
        }
    },

    sendConditionToChat = function (key) {
        let condition = getConditionByKey(key);
        if (!condition) {
            return;
        }

        let icon = '';
        if (['Combat Master','Token Marker'].includes(condition.iconType)) {
            icon = getDefaultIcon(condition.iconType,condition.icon, 'margin-right: 5px; margin-top: 5px; display: inline-block;') || '';
        }
        makeAndSendMenu(condition.description,icon+condition.name,(state[combatState].config.status.sendOnlyToGM) ? 'gm' : '');
    },

    addTargetsToCondition = function(selectedTokens,id,key) {
        if (!selectedTokens || selectedTokens.length == 0) {
            makeAndSendMenu('No tokens selected. Condition not added',' ', 'gm');
            return;
        }
        state[combatState].conditions.forEach((condition) => {
            if (condition.id == id && condition.key == key) {
                condition.target = condition.target || [];
                selectedTokens.forEach(token => {
                    const targetObj = getObj('graphic', token._id);
                    if (!targetObj) {
                        return;
                    }
                    condition.target.push(token._id);
                    addMarker(targetObj, condition.iconType, condition.icon, condition.duration, condition.direction, condition.key);
                    doAddConditionCalls(targetObj, condition.key);
                });
            }
        });
        makeAndSendMenu('Selected Tokens Added',"Selected Tokens",'gm');
    },

//*************************************************************************************************************
//START/STOP COMBAT
//*************************************************************************************************************
    verifySetup = function(selectedTokens, initiative) {
        if ((!selectedTokens || selectedTokens.length == 0) && !state[combatState].config.hold.held && initiative.rollInitiative != 'None') {
            makeAndSendMenu('No tokens selected. Combat not started',' ', 'gm');
            return false;
        }

        if (initiative.rollInitiative == 'None') {
            if (getTurnorder().length == 0) {
                makeAndSendMenu('Auto Roll Initiative has been set to None and your turn order is currently empty',' ', 'gm');
                return false;
            }
        }

        if (initiative.rollInitiative == 'CombatMaster' && !state[combatState].config.hold.held) {
            selectedTokens.forEach(token => {
                if (token._type == 'graphic') {
                    let tokenObj = getObj('graphic', token._id);
                    if (tokenObj && !getObj('character', tokenObj.get('represents'))) {
                        makeAndSendMenu('The token "'+(tokenObj.get('name') || 'unnamed')+'" is not linked to a character sheet and gets no initiative',' ', 'gm');
                    }
                }
            });
        }

        return true;
    },

    startCombat = async function (selectedTokens, who) {
        if (debug) {
            log('Start Combat');
        }

        let initiative = state[combatState].config.initiative;
        let hold       = state[combatState].config.hold;
        let verified   = verifySetup(selectedTokens, initiative);

        if (!verified && !hold.held) {
            return;
        }

        Campaign().set('initiativepage', Campaign().get('playerpageid'));
        paused = false;

        if (hold.held) {
            restartCombat(hold, who);
        } else if (initiative.rollInitiative == 'CombatMaster') {
            await rollInitiative(selectedTokens, initiative);
        } else if (initiative.rollInitiative == 'Group-Init') {
            if (!rollGroupInit(selectedTokens)) {
                return;
            }
            // GroupInitiative is async too, so wait until it has filled the tracker
            if (!(await waitForTurnorder(15000))) {
                makeAndSendMenu('GroupInitiative did not fill the turn order. Combat not started.', '', 'gm');
                return;
            }
        }

        if (!hold.held && getTurnorder().length == 0) {
            makeAndSendMenu('The turn order is empty. Combat not started.', '', 'gm');
            return;
        }

        const wasHeld = hold.held;
        setTimeout(function() {
            doRoundCalls();
            doTurnorderChange();
            sendMainMenu(who || 'gm');
        }, wasHeld ? 2000 : 500);
    },

    restartCombat = function (hold) {
        round = hold.round;
        setTurnorder(hold.turnorder);
        state[combatState].conditions = hold.conditions;

        setTimeout(function() {
            clearHold(hold);
        },1000);
    },

    stopCombat = function (who) {
        if (debug) {
            log('Stop Combat');
        }

        clearHold(state[combatState].config.hold);

        if (state[combatState].config.status.clearConditions) {
            [...state[combatState].conditions].forEach((condition) => {
                if (!isMarkerToken(condition.id)) {
                    removeConditionFromToken(getObj('graphic',condition.id), condition.key, true);
                }
            });
        }

        removeMarkers();
        stopTimer();
        stopMarkerAnimation();
        Campaign().set({initiativepage:false,turnorder:''});
        round = 1;

        setTimeout(function() {
            state[combatState].conditions = [];
            sendMainMenu(who ? who : 'gm');
        },2000);
    },

    holdCombat = function (who) {
        let hold        = state[combatState].config.hold;
        hold.held       = true;
        hold.turnorder  = getTurnorder();
        hold.round      = round;
        hold.conditions = [...state[combatState].conditions];

        Campaign().set({initiativepage:false,turnorder:''});
        pauseTimer();

        setTimeout(function() {
            state[combatState].conditions = [];
            sendMainMenu(who);
        },2000);
    },

    clearHold = function (hold) {
        hold.held = false;
        hold.round = 1;
        hold.turnorder = [];
        hold.conditions = [];
    },

    // Async: waits for every sheet value before writing the turn order
    rollInitiative = async function (selectedTokens, initiative) {
        const initAttributes = String(initiative.initiativeAttributes || '').split(',').map(a => a.trim()).filter(a => a && a !== 'None');
        const die            = parseInt(initiative.initiativeDie) || 20;
        const newTurns       = [];

        for (const token of (selectedTokens || [])) {
            if (!token || token._type !== 'graphic' || isMarkerToken(token._id)) {
                continue;
            }
            const tokenObj = getObj('graphic', token._id);
            if (!tokenObj) {
                continue;
            }
            const characterObj = getObj('character', tokenObj.get('represents'));
            if (!characterObj) {
                continue;
            }

            const whisperTo = (tokenObj.get('layer') === 'gmlayer') ? 'gm' : '';

            let initiativeMod = 0;
            const missing = [];
            for (const attribute of initAttributes) {
                const value = await getSheetNumber(characterObj.id, attribute);
                if (value === undefined) {
                    // init_tiebreaker is optional, everything else should exist
                    if (attribute !== 'init_tiebreaker') {
                        missing.push(attribute);
                    }
                } else {
                    initiativeMod += value;
                }
            }
            if (missing.length) {
                warnMissingAttributes(characterObj, missing);
            }
            initiativeMod = Math.round(initiativeMod * 100) / 100;

            // Advantage and Disadvantage
            let advantage    = false;
            let disadvantage = false;

            // 2014 OGL sheet stores its advantage setting in initiative_style
            if (!isBeaconCharacter(characterObj)) {
                const style = await getSheetValue(characterObj.id, 'initiative_style');
                if (style == '{@{d20},@{d20}}kh1') {
                    advantage = true;
                }
            }
            // 2024 rules: Invisible gives Advantage, Incapacitated gives Disadvantage
            if (hasCondition(tokenObj.id, 'invisible') || hasCondition(tokenObj.id, 'invisibility')) {
                advantage = true;
            }
            if (incapacitatingConditions.some(key => hasCondition(tokenObj.id, key))) {
                disadvantage = true;
            }
            if (advantage && disadvantage) {
                advantage = disadvantage = false;
            }

            const roll1 = randomInteger(die);
            const roll2 = (advantage || disadvantage) ? randomInteger(die) : null;
            const used  = (roll2 === null) ? roll1 : (advantage ? Math.max(roll1, roll2) : Math.min(roll1, roll2));

            if (initiative.showInitiative) {
                sendInitiativeChat(tokenObj.get('name'), roll1, initiativeMod, roll2, whisperTo, advantage ? 'Advantage' : disadvantage ? 'Disadvantage' : '');
            }

            const total = used + initiativeMod;
            newTurns.push({
                id: tokenObj.id,
                pr: Number.isInteger(total) ? total : total.toFixed(2),
                custom: '',
                _pageid: tokenObj.get("pageid")
            });
        }

        // Write all turns at once (fewer turn order updates, no race conditions)
        if (newTurns.length) {
            const turnorder = getTurnorder().filter(t => !newTurns.some(n => n.id === t.id));
            setTurnorder(turnorder.concat(newTurns));
        }

        if (state[combatState].config.turnorder.sortTurnOrder) {
            sortTurnorder();
        }
    },

    rollGroupInit = function (selectedTokens) {
        if ('undefined' !== typeof GroupInitiative && GroupInitiative.RollForTokenIDs) {
            GroupInitiative.RollForTokenIDs(
                (selectedTokens||[]).map(s => s._id).filter(id => !isMarkerToken(id)), {manualBonus: 0}
            );
            return true;
        }
        makeAndSendMenu('Roll Initiative is set to Group-Init, but the GroupInitiative script is not installed.', 'Initiative', 'gm');
        return false;
    },

    sendInitiativeChat = function (name,rollInit,bonus,rollInit1,whisperTo,label) {
        let contents = '<table style="width: 50%; text-align: left; float: left;"><tr><th>Modifier</th><td>'+bonus+'</td></tr></table>' +
                       '<div style="text-align: center"><b style="font-size: 14pt;"><span style="border: 1px solid green; padding-bottom: 2px; padding-top: 4px;">[['+rollInit+'+'+bonus+']]</span><br><br></b></div>';

        if (rollInit1 !== null && rollInit1 !== undefined) {
            contents += '<div style="text-align: center"><b style="font-size: 10pt;"><span style="border: 1px solid red; padding-bottom: 2px; padding-top: 4px;">[['+rollInit1+'+'+bonus+']]</span><br><br></b></div>';
        }
        if (label) {
            contents += '<div style="text-align: center; clear: both"><i>' + label + '</i></div>';
        }

        makeAndSendMenu(contents, HE(name || 'Token') + ' Initiative', whisperTo);
    },

//*************************************************************************************************************
//MARKERS
//*************************************************************************************************************
    addMarker = function(tokenObj, markerType, marker, duration, direction, key) {
        if (!tokenObj) {
            return;
        }

        if (!verifyInstalls(markerType)) {
            return;
        }

        let icon = getIconTag(markerType, marker);
        if (!icon) {
            return;
        }

        removeMarker(tokenObj, markerType, marker);

        setTimeout(() => {
            let statusMarkers = returnMarkers(tokenObj);
            let statusMarker;
            if (key == 'dead' || duration <= 0 || duration >= 10 || (duration == 1 && direction == 0)) {
                statusMarker = icon;
            } else {
                statusMarker = icon+'@'+duration;
            }

            statusMarkers.push(statusMarker);
            tokenObj.set('statusmarkers', statusMarkers.join(','));
        }, 500);
    },

    removeMarker = function(tokenObj, markerType, marker) {
        if (!tokenObj || !verifyInstalls(markerType)) {
            return;
        }

        let iconTag = getIconTag(markerType, marker);
        if (!iconTag) {
            return;
        }

        const statusMarkers = returnMarkers(tokenObj).filter(m => m.split('@')[0] !== iconTag);
        tokenObj.set('statusmarkers', statusMarkers.join(','));
    },

    returnMarkers = function(tokenObj) {
        return String(tokenObj.get('statusmarkers') || '').split(',').filter(m => m);
    },

    getMarkerIds = function () {
        if (!state[combatState].markerIds) {
            state[combatState].markerIds = {current: null, next: null};
        }
        return state[combatState].markerIds;
    },

    getMarkerImage = function (next=false) {
        const turnorder = state[combatState].config.turnorder;
        const type      = (next) ? turnorder.nextMarkerType : turnorder.markerType;
        let imgsrc;

        if (type == 'Token Marker' && 'undefined' !== typeof libTokenMarkers) {
            const name   = (next) ? turnorder.nextTokenMarkerName : turnorder.tokenMarkerName;
            const status = (name && name !== 'None') ? libTokenMarkers.getStatus(name) : null;
            imgsrc = status && status.url;
        }
        if (!getCleanImgsrc(imgsrc)) {
            imgsrc = (next) ? turnorder.nextExternalMarkerURL : turnorder.externalMarkerURL;
        }
        return getCleanImgsrc(imgsrc) || getCleanImgsrc((next) ? defaultMarkerURLs.next : defaultMarkerURLs.current);
    },

    // True for our turn markers. Never creates a marker.
    isMarkerToken = function (id) {
        if (!id) {
            return false;
        }
        const ids = getMarkerIds();
        if (id === ids.current || id === ids.next) {
            return true;
        }
        // Markers left behind by older CombatMaster versions
        const obj = getObj('graphic', id);
        if (!obj || obj.get('represents')) {
            return false;
        }
        const name = obj.get('name') || '';
        return name === 'NextMarker' || /^Round -?\d+$/.test(name);
    },

    findTurnMarker = function (next=false) {
        const ids = getMarkerIds();
        const id  = (next) ? ids.next : ids.current;
        return (id) ? getObj('graphic', id) : undefined;
    },

    resetMarker = function (next=false) {
        let marker = getOrCreateMarker(next);
        if (marker.isNull) {
            return marker;
        }

        marker.set({
            name: (next) ? 'NextMarker' : 'Round ' + round,
            layer: 'gmlayer',
            left: 35, top: 35,
            width: 70, height: 70
        });

        return marker;
    },

    getOrCreateMarker = function (next=false) {
        const pageid = Campaign().get('playerpageid');
        const ids    = getMarkerIds();
        let marker   = findTurnMarker(next);

        if (marker && marker.get('pageid') !== pageid) {
            marker.remove();
            marker = undefined;
        }

        if (!marker) {
            // re-use markers left on the page by older versions of CombatMaster
            const legacy = findObjs({_type: 'graphic', _pageid: pageid}).filter(g => {
                const name = g.get('name') || '';
                if (g.get('represents')) {
                    return false;
                }
                return (next) ? name === 'NextMarker' : /^Round -?\d+$/.test(name);
            });
            marker = legacy.shift();
            legacy.forEach(extra => extra.remove());
        }

        if (!marker) {
            marker = createObj('graphic', {
                subtype: 'token',
                name: (next) ? 'NextMarker' : 'Round ' + round,
                imgsrc: getMarkerImage(next),
                pageid: pageid,
                layer: 'gmlayer',
                showplayers_name: true,
                left: 35, top: 35,
                width: 70, height: 70
            });
        }

        if (!marker) {
            if (!markerWarned) {
                markerWarned = true;
                makeAndSendMenu('Could not create the turn marker. The marker image must be in a Roll20 library. Check the marker URL in Setup, Turnorder.', 'Turn Marker', 'gm');
            }
            return nullMarker;
        }

        if (next) {
            ids.next = marker.id;
        } else {
            ids.current = marker.id;
            checkMarkerturn(marker);
        }

        toBack(marker);

        return marker;
    },

    checkMarkerturn = function (marker) {
        if (!marker || marker.isNull) {
            return;
        }
        let turnorder = getTurnorder();
        if (!turnorder.some(turn => turn.id === marker.get('id'))) {
            turnorder.push({ id: marker.get('id'), pr: -1, custom: '', _pageid: marker.get('pageid') });
            setTurnorder(turnorder);
        }
    },

    removeMarkers = function () {
        stopMarkerAnimation();
        [findTurnMarker(false), findTurnMarker(true)].forEach(marker => {
            if (marker) {
                marker.remove();
            }
        });
        const ids = getMarkerIds();
        ids.current = null;
        ids.next = null;
    },

    changeMarker = function (token, next=false) {
        let marker = getOrCreateMarker(next);
        if (marker.isNull) {
            return;
        }

        if (!token) {
            resetMarker(next);
            return;
        }
        const size = parseFloat(state[combatState].config.turnorder.markerSize) || 1.35;
        let position = {
            top: token.get('top'),
            left: token.get('left'),
            width: token.get('width') * size,
            height: token.get('height') * size,
        };

        if (token.get('layer') !== marker.get('layer')) {
            if (marker.get('layer') === 'gmlayer') {
                marker.set(position);
                setTimeout(() => {
                    if (state[combatState].config.turnorder.useMarker) {
                        marker.set({ layer: 'objects' });
                    }
                }, 500);
            } else {
                marker.set({ layer: 'gmlayer' });
                setTimeout(() => {
                    marker.set(position);
                }, 500);
            }
        } else {
            marker.set(position);
        }

        toBack(marker);
    },

    centerToken = function (token) {
        if (state[combatState].config.turnorder.centerToken) {
            if (token.get('layer') != 'gmlayer') {
                sendPing(token.get('left'), token.get('top'), token.get('pageid'), null, true);
            }
        }
    },

    handleStatusMarkerChange = function (obj, prev) {
        prev.statusmarkers = (typeof prev.get === 'function') ? prev.get('statusmarkers') : prev.statusmarkers;

        if (typeof prev.statusmarkers === 'string') {
            if (obj.get('statusmarkers') !== prev.statusmarkers) {
                const prevstatusmarkers = prev.statusmarkers.split(",").filter(m => m);
                const newstatusmarkers  = String(obj.get('statusmarkers') || '').split(",").filter(m => m);
                const base = (m) => m.split('@')[0];
                const prevBases = prevstatusmarkers.map(base);
                const newBases  = newstatusmarkers.map(base);

                prevstatusmarkers.forEach((marker) => {
                    let condition = getConditionByMarker(marker);
                    if (condition && !newBases.includes(base(marker))) {
                        removeConditionFromToken(obj, condition.key, true);
                    }
                });

                newstatusmarkers.forEach(function(marker){
                    let condition = getConditionByMarker(marker);
                    if (condition && !prevBases.includes(base(marker))) {
                        addConditionToToken(obj,condition.key,condition.duration,condition.direction,condition.message);
                    }
                });
            }
        }
    },

    startMarkerAnimation = function(marker) {
        if (state[combatState].config.turnorder.animateMarker) {
            clearInterval(animationHandle);
            animateMarker(marker);
        }
    },

    stopMarkerAnimation = function() {
        clearInterval(animationHandle);
    },

    animateMarker = function(marker) {
        const step = parseFloat(state[combatState].config.turnorder.animateMarkerDegree) || 15;
        const wait = parseInt(state[combatState].config.turnorder.animateMarkerWait) || 250;
        animationHandle = setInterval(() => {
            marker.set('rotation', (parseFloat(marker.get('rotation')) || 0) + step);
        }, wait);
    },

//*************************************************************************************************************
//TURNORDER
//*************************************************************************************************************
    clearTurnorder = function () {
        Campaign().set({ turnorder: '' });
        state[combatState].turnorder = {};
    },

    verifyTurnorder = function () {
        if (getTurnorder().length == 0) {
            makeAndSendMenu('The Turnorder is empty. Combat not started',null,'gm');
            stopCombat();
            return false;
        }
        return true;
    },

    doTurnorderChange = function (prev=false, delay=false) {
        if (!verifyTurnorder()) {
            return;
        }
        let turn     = getCurrentTurn();
        if (!turn) {
            return;
        }
        let marker   = getOrCreateMarker();
        let tokenObj = (turn.id && turn.id !== '-1') ? getObj('graphic', turn.id) : undefined;

        if (turn.id === '-1') {
            doRoundCalls();
            nextTurn();
            return;
        }

        if (turn.id === marker.id) {
            if (prev) {
                prevRound();
            } else {
                nextRound();
            }
            return;
        }

        if (tokenObj) {
            toFront(tokenObj);

            if (state[combatState].config.timer.useTimer) {
                startTimer(tokenObj);
            }

            changeMarker(tokenObj);
            announcePlayer(tokenObj, prev, delay);
            centerToken(tokenObj);
            if (state[combatState].config.turnorder.animateMarker) {
                startMarkerAnimation(marker);
            } else {
                stopMarkerAnimation();
            }
            setTimeout(function() {
                doTurnCalls(tokenObj);
            },1000);
        } else {
            resetMarker();
        }

        if (state[combatState].config.turnorder.nextMarkerType != 'None') {
            let upNext = getNextTurn();
            if (upNext) {
                let nextToken = getObj('graphic', upNext.id);
                if (nextToken) {
                    toFront(nextToken);
                    changeMarker(nextToken, true);
                } else {
                    resetMarker(true);
                }
            }
        }
    },

    handleTurnorderChange = function (obj, prev) {
        if (!obj || !prev || obj.get('turnorder') === prev.turnorder) {
            return;
        }

        let turnorder, prevTurnorder;
        try {
            turnorder     = (!obj.get('turnorder')) ? [] : JSON.parse(obj.get('turnorder'));
            prevTurnorder = (!prev.turnorder) ? [] : JSON.parse(prev.turnorder);
        } catch (e) {
            return;
        }

        // Only react while CombatMaster is running a combat
        if (!getMarkerIds().current || state[combatState].config.hold.held) {
            return;
        }

        // The GM cleared the Turn Tracker by hand
        if (turnorder.length === 0) {
            stopCombat();
            return;
        }

        if (!turnorder.some(t => isMarkerToken(t.id))) {
            return;
        }

        if (prevTurnorder.length && turnorder[0].id !== prevTurnorder[0].id) {
            if (turnorder[0].pr == -1 && prevTurnorder[1] && prevTurnorder[1].pr != -1) {
                doTurnorderChange(true);
            } else {
                doTurnorderChange();
            }
        }
    },

    sortTurnorder = function (order='DESC') {
        let turnorder = getTurnorder();

        turnorder.sort((a,b) => {
            return (order === 'ASC') ? parseFloat(a.pr) - parseFloat(b.pr) : parseFloat(b.pr) - parseFloat(a.pr);
        });

        setTurnorder(turnorder);
    },

    getTurnorder = function () {
        const raw = Campaign().get('turnorder');
        if (!raw) {
            return [];
        }
        try {
            return Array.from(JSON.parse(raw));
        } catch (e) {
            return [];
        }
    },

    addToTurnorder = function (turn) {
        let turnorder = getTurnorder();
        turnorder.push(turn);
        setTurnorder(turnorder);
    },

    setTurnorder = function (turnorder) {
        Campaign().set('turnorder', JSON.stringify(turnorder));
    },

//*************************************************************************************************************
//TURNS
//*************************************************************************************************************
    delayTurn = async function () {
        let turnorder   = getTurnorder();
        let currentTurn = turnorder.shift();
        let veryNext    = getVeryNextTurn();

        if (!currentTurn || !veryNext) {
            return;
        }

        if (isMarkerToken(veryNext.id)) {
            setTurnorder(turnorder);
            await nextRound();
            turnorder = getTurnorder();
            let delayed = currentTurn;
            currentTurn = turnorder.shift();
            turnorder.unshift(delayed);
            turnorder.unshift(currentTurn);
            setTurnorder(turnorder);
            return;
        }

        let upNext = turnorder.shift();
        turnorder.unshift(currentTurn);
        turnorder.unshift(upNext);

        setTurnorder(turnorder);
        doTurnorderChange(false,true);
    },

    nextTurn = function() {
        let turnorder   = getTurnorder();
        let currentTurn = turnorder.shift();
        if (currentTurn) {
            turnorder.push(currentTurn);
        }
        setTurnorder(turnorder);
        doTurnorderChange();
    },

    previousTurn = function() {
        let turnorder = getTurnorder();
        let last_turn = turnorder.pop();
        if (last_turn) {
            turnorder.unshift(last_turn);
        }

        setTurnorder(turnorder);
        doTurnorderChange(true);
    },

    nextRound = async function () {
        let marker     = getOrCreateMarker();
        let initiative = state[combatState].config.initiative;

        round++;
        marker.set({ name: 'Round ' + round});

        if (state[combatState].config.announcements.announceRound) {
            let text = '<span style="font-size: 12pt; font-weight: bold;">'+'Round ' + round+'</span>';
            makeAndSendMenu(text, ' ');
        }

        if (initiative.rollEachRound && initiative.rollInitiative == 'CombatMaster') {
            let turnorder = getTurnorder();
            clearTurnorder();
            checkMarkerturn(marker);
            await rollInitiative(turnorder.map(t => (t.id && t.id !== marker.id) ? { _type: 'graphic', _id: t.id } : false), initiative);
            doTurnorderChange();
        } else {
            nextTurn();
            if (state[combatState].config.turnorder.sortTurnOrder) {
                sortTurnorder();
            }
        }
    },

    getCurrentTurn = function () {
        return getTurnorder().shift();
    },

    getNextTurn = function () {
        return getTurnorder().find((turn, i) => i > 0 && turn.id !== '-1' && !isMarkerToken(turn.id));
    },

    getVeryNextTurn = function () {
        return getTurnorder()[1];
    },

    prevRound = function () {
        let marker = getOrCreateMarker();
        round--;
        marker.set({ name: 'Round ' + round});

        if (state[combatState].config.announcements.announceRound) {
            let text = '<span style="font-size: 16pt; font-weight: bold;">'+'Round ' + round+'</span>';
            makeAndSendMenu(text, ' ');
        }

        previousTurn();
    },

//*************************************************************************************************************
//TIMER
//*************************************************************************************************************
    startTimer = function (token) {
        let timer = state[combatState].config.timer,
            config_time = parseInt(timer.time) || 120,
            time = config_time;

        paused = false;

        clearInterval(intervalHandle);

        if (timerObj) {
            timerObj.remove();
            timerObj = null;
        }

        if (token && timer.showTokenTimer) {
            timerObj = createObj('text', {
                text: 'Timer: ' + time,
                font_size: timer.timerFontSize,
                font_family: timer.timerFont,
                color: timer.timerFontColor,
                pageid: token.get('pageid'),
                layer: 'gmlayer'
            });
        }

        intervalHandle = setInterval(() => {
            if (paused) {
                return;
            }

            if (!token || !getObj('graphic', token.id)) {
                stopTimer();
                return;
            }

            if (timerObj && timer.showTokenTimer) {
                timerObj.set({
                    top: token.get('top')+token.get('width')/2+40,
                    left: token.get('left'),
                    text: 'Timer: ' + time,
                    layer: token.get('layer')
                });
            }

            if (timer.sendTimerToChat && (time === config_time || config_time/2 === time || config_time/4 === time || time === 10 || time === 5)) {
                makeAndSendMenu('', 'Time Remaining: ' + time);
            }

            if (time <= 0) {
                stopTimer();
                if (timer.skipTurn) {
                    nextTurn();
                } else if (token.get('layer') !== 'gmlayer') {
                    makeAndSendMenu(token.get('name') + "'s time ran out!", '');
                }
            }

            time--;
        }, 1000);
    },

    stopTimer = function () {
        clearInterval(intervalHandle);
        if (timerObj) {
            timerObj.remove();
            timerObj = null;
        }
    },

    pauseTimer = function () {
        paused = !paused;
    },

//*************************************************************************************************************
//ANNOUNCE
//*************************************************************************************************************
    announcePlayer = function (tokenObj, prev, delay=false, show) {
        if (!tokenObj) {
            return;
        }

        let name       = tokenObj.get('name');
        let imgurl     = tokenObj.get('imgsrc');
        let conditions = getAnnounceConditions(tokenObj, prev, delay, show);
        let image      = (imgurl) ? '<img src="'+imgurl+'" width="50px" height="50px"  />' : '';
        name           = (state[combatState].config.announcements.handleLongName) ? handleLongString(name) : name;

        let title       = 'Conditions';
        let doneButton  = makeImageButton('!cmaster --turn,next',doneImage,'Done with Round','transparent',18,'white');
        let delayButton = makeImageButton('!cmaster --turn,delay',delayImage,'Delay your Turn','transparent',18, 'white');

        if (!show) {
            title += '<div style="'+styles.buttonRight+'">'+doneButton+'</div>';
            title += '<div style="'+styles.buttonRight+'">'+delayButton+'</div>';
        }

        let contents = '<div style="'+styles.announcePlayer+'">'+image+'</div>';

        if (!show) {
            contents += '<div style="'+styles.announcePlayer+'">'+name+'\'s Turn</div>';
        } else {
            contents += '<div style="'+styles.announcePlayer+'">'+name+'</div>';
        }

        contents += conditions;

        let characterObj = getObj('character', tokenObj.get('represents'));

        if (characterObj) {
            let controlledBy = characterObj.get('controlledby') || '';
            let players      = controlledBy.split(",");

            if (state[combatState].config.status.userChanges) {
                players.forEach((pid) => {
                    let playerObj = getObj('player', pid);
                    if (playerObj) {
                        sendMainMenu(playerObj.get('displayname'));
                    }
                });
            }

            if (state[combatState].config.announcements.announceTurn || show) {
                let target;
                if (players[0] != "") {
                    target = (state[combatState].config.announcements.whisperToGM) ? 'gm' : '';
                } else {
                    target = (!state[combatState].config.announcements.showNPCTurns) ? 'gm' : '';
                }
                makeAndSendMenu(contents,title,target);
            }
        } else if (show) {
            makeAndSendMenu(contents,title,'gm');
        }
    },

    getAnnounceConditions = function (tokenObj, prev, delay, show) {
        const tokenID = tokenObj.get("_id");
        let output = '<div>';

        if (state[combatState].conditions) {
            [...state[combatState].conditions].forEach(condition => {
                const targets  = condition.target || [];
                const isTarget = targets.includes(tokenID);
                let removed    = false;

                if (condition.id != tokenID && !isTarget) {
                    return;
                }

                let descriptionButton = makeButton(condition.name, '!cmaster --show,description,key='+condition.key);
                if (!isTarget && !delay && !show) {
                    if (!prev) {
                        condition.duration = condition.duration + condition.direction;
                    } else {
                        condition.duration = condition.duration - condition.direction;
                    }
                }

                const hasMessage = condition.message && condition.message != 'None' && String(condition.message).length > 0;

                if (condition.duration <= 0 && condition.direction != 0) {
                    output += '<div style="display:inline-block;"><strong>'+descriptionButton+'</strong> removed</div>';
                    if (!delay && !show && !isTarget) {
                        removeConditionFromToken(tokenObj, condition.key, true);
                        removed = true;
                    }
                } else if (condition.duration > 0 && condition.direction != 0) {
                    output += '<div style="display:inline-block;"><strong>'+descriptionButton+'</strong> '+condition.duration+' Rounds Left</div>';
                    if (!delay && !show && !isTarget) {
                        addConditionToToken(tokenObj,condition.key,condition.duration,condition.direction,condition.message);
                    }
                    if (hasMessage) {
                        output += '<div style="display:inline-block;"><strong>Message: </strong>'+condition.message + '</div>';
                    }
                } else if (condition.direction == 0) {
                    output += '<div style="display:inline-block;"><strong>'+descriptionButton+'</strong> '+condition.duration+' Permanent</div>';
                    if (hasMessage) {
                        output += '<div style="display:inline-block;"><strong>Message: </strong> '+condition.message+ '</div>';
                    }
                }

                if (!removed) {
                    let removeButton = makeImageButton('!cmaster --remove,condition='+condition.key+',id='+tokenID,deleteImage,'Remove Condition','transparent',18);
                    output += '<div style="'+styles.buttonRight+'">'+removeButton+'</div>';
                }
            });
        }
        output += '</div>';

        return output;
    },

//*************************************************************************************************************
//MAKES
//*************************************************************************************************************
    makeAndSendMenu = function (contents, title, whisperTo) {
        let prefix = '';
        if (whisperTo && String(whisperTo).trim() !== '') {
            const target = String(whisperTo).trim();
            // Names with spaces must be quoted, or the whisper goes to the wrong place
            prefix = '/w ' + ((/\s/.test(target) && !/^".*"$/.test(target)) ? '"' + target + '"' : target) + ' ';
        }
        sendChat(script_name, prefix + '<div style="'+styles.menu+styles.overflow+'">'+makeTitle(title || '')+(contents || '')+'</div>', null, {noarchive:true});
    },

    makeBanner = function (command,title,previous) {
        let backButton = makeBigButton('Back', '!cmaster --back,'+previous);
        let helpButton = makeImageButton('!cmaster --help,'+command,helpImage,'Help','transparent',18,'white');
        let titleText  = title+' Setup'+'<span style="'+styles.buttonRight+'">'+helpButton+'</span>';

        return {
            backButton,
            titleText
        };
    },

    makeTitle = function (title) {
        return '<div style="'+styles.title+'"><span style="'+styles.titleText+'">'+title+'</span></div>';
    },

    makeBigButton = function (title, href) {
        return '<div style="'+styles.bigButton+'"><a style="'+styles.bigButtonLink+'" href="'+href+'">'+title+'</a></div>';
    },

    makeButton = function (title, href) {
        return '<a style="'+styles.conditionButton+'" href="'+href+'">'+title+'</a>';
    },

    makeTextButton = function (label, value, href) {
        return '<span style="'+styles.textLabel+'">'+label+'</span><a style="'+styles.textButton+'" href="'+href+'">'+value+'</a>';
    },

    makeImageButton = function(command, image, toolTip, backgroundColor,size,color){
        if (!color) {
            color = 'black';
        }
        return '<div style="display:inline-block;margin-right:3px;padding:1px;vertical-align:middle;"><a href="'+command+'" title= "'+toolTip+'" style="margin:0px;padding:0px;border:0px solid;background-color:'+backgroundColor+'"><span style="color:'+color+';padding:0px;font-size:'+size+'px;font-family: \'Pictos\'">'+image+'</span></a></div>';
    },

    makeList = function (items, backButton, extraButton) {
        let list = '<ul style="'+styles.reset + styles.list + styles.overflow+'">';
        items.forEach((item) => {
            list += '<li style="'+styles.overflow+'">'+item+'</li>';
        });
        list += '</ul>';

        if (extraButton) {
            list += extraButton;
        }
        if (backButton) {
            list += '<hr>'+backButton;
        }
        return list;
    },

//*************************************************************************************************************
//ICONS
//*************************************************************************************************************
    getDefaultIcon = function (iconType, icon, style='', height, width) {
        if (iconType == 'None') {
            return 'None';
        }

        let installed = verifyInstalls(iconType);

        if (iconType == 'Token Marker' && installed) {
            return libTokenMarkers.getStatus(icon).getHTML(1.7);
        } else if (iconType == 'Combat Master') {
            let X = '';
            let iconStyle = '';

            if (typeof icon_image_positions[icon] === 'undefined') {
                return '';
            }

            if (width) {
                iconStyle += 'width: '+width+'px;height: '+height+'px;';
            } else {
                iconStyle += 'width: 24px; height: 24px;';
            }

            if (Number.isInteger(icon_image_positions[icon])) {
                iconStyle += 'background-image: url(https://roll20.net/images/statussheet.png);';
                iconStyle += 'background-repeat: no-repeat;';
                iconStyle += 'background-position: -'+icon_image_positions[icon]+'px 0;';
            } else if (icon_image_positions[icon] === 'X') {
                iconStyle += 'color: red; margin-right: 0px;';
                X = 'X';
            } else {
                iconStyle += 'background-color: ' + icon_image_positions[icon] + ';';
                iconStyle += 'border: 1px solid white; border-radius: 50%;';
            }

            iconStyle += style;

            return '<div style="vertical-align:middle;'+iconStyle+'">'+X+'</div>';
        } else if (iconType == 'Token Condition') {
            return '<b>TC </b> ';
        }
        return '';
    },

    getTokenMarkers = function () {
        return libTokenMarkers.getOrderedList();
    },

    getIconTag = function (iconType,iconName) {
        if (!verifyInstalls(iconType)) {
            return;
        }

        let iconTag = null;
        if (iconType == 'Token Marker') {
            iconTag = libTokenMarkers.getStatus(iconName).getTag();
        } else if (iconType == 'Combat Master') {
            iconTag = iconName;
        }

        return iconTag;
    },

    verifyInstalls = function(iconType) {
        if (iconType == 'Token Marker' && 'undefined' == typeof libTokenMarkers) {
            makeAndSendMenu('libTokenMarker API must be installed if using Custom Icons.', '', 'gm');
            return false;
        } else if (iconType == 'Token Condition' && 'undefined' == typeof TokenCondition) {
            makeAndSendMenu('Token Condition API must be installed if using Token Condition.', '', 'gm');
            return false;
        }
        return true;
    },

//*************************************************************************************************************
//EXTERNAL CALLS
//*************************************************************************************************************
    isSet = function (value) {
        return value !== undefined && value !== null && !['None',''].includes(value);
    },

    doRoundCalls = function () {
        if (!verifyTurnorder()) {
            return;
        }

        let config = state[combatState].config.turnorder;

        getTurnorder().forEach((turn) => {
            if (isMarkerToken(turn.id)) {
                return;
            }
            let tokenObj = getObj('graphic',turn.id);
            if (!tokenObj) {
                return;
            }
            let characterObj = getObj('character',tokenObj.get('represents'));
            if (!characterObj) {
                return;
            }
            if (isSet(config.allRoundMacro)) {
                let macro = getMacro(tokenObj, config.allRoundMacro);
                if (macro) {
                    sendCalltoChat(tokenObj,characterObj,macro.get('action'));
                }
            }
            if (isSet(config.characterRoundMacro) && characterObj.get('controlledby') != '') {
                let macro = getMacro(tokenObj, config.characterRoundMacro);
                if (macro) {
                    sendCalltoChat(tokenObj,characterObj,macro.get('action'));
                }
            }
            if (isSet(config.roundAPI)) {
                sendCalltoChat(tokenObj,characterObj,config.roundAPI);
            }
            if (isSet(config.roundRoll20AM)) {
                sendCalltoChat(tokenObj,characterObj,config.roundRoll20AM);
            }
            if (isSet(config.roundFX)) {
                doFX(tokenObj,config.roundFX);
            }
        });
    },

    doTurnCalls = function (tokenObj) {
        let config = state[combatState].config.turnorder;
        let characterObj = getObj('character',tokenObj.get('represents'));

        if (!characterObj) {
            return;
        }

        if (isSet(config.turnMacro)) {
            let macro = getMacro(tokenObj, config.turnMacro);
            if (macro) {
                sendCalltoChat(tokenObj,characterObj,macro.get('action'));
            }
        }

        state[combatState].conditions.forEach((condition) => {
            if (tokenObj.get('_id') == condition.id && condition.addPersistentMacro && isSet(condition.addMacro)) {
                let macro = getMacro(tokenObj, condition.addMacro);
                if (macro) {
                    sendCalltoChat(tokenObj,characterObj,macro.get('action'));
                }
            }
        });

        if (isSet(config.turnAPI)) {
            sendCalltoChat(tokenObj,characterObj,config.turnAPI);
        }
        if (isSet(config.turnRoll20AM)) {
            sendCalltoChat(tokenObj,characterObj,config.turnRoll20AM);
        }
        if (isSet(config.turnFX)) {
            doFX(tokenObj,config.turnFX);
        }
    },

    doAddConditionCalls = function (tokenObj,key) {
        let condition = getConditionByKey(key);
        if (!condition || !tokenObj) {
            return;
        }

        let characterObj = getObj('character',tokenObj.get('represents'));

        if (characterObj) {
            if (isSet(condition.addMacro)) {
                let macro = getMacro(tokenObj, condition.addMacro);
                if (macro) {
                    sendCalltoChat(tokenObj,characterObj,macro.get('action'));
                }
            }
            if (isSet(condition.addAPI)) {
                sendCalltoChat(tokenObj,characterObj,condition.addAPI);
            }
            if (isSet(condition.addRoll20AM)) {
                sendCalltoChat(tokenObj,characterObj,condition.addRoll20AM);
            }
            if (isSet(condition.addFX)) {
                doFX(tokenObj,condition.addFX);
            }
        }
    },

    doRemoveConditionCalls = function (tokenObj,key) {
        let condition = getConditionByKey(key);
        if (!condition || !tokenObj) {
            return;
        }

        let characterObj = getObj('character',tokenObj.get('represents'));

        if (characterObj) {
            if (isSet(condition.remMacro)) {
                let macro = getMacro(tokenObj, condition.remMacro);
                if (macro) {
                    sendCalltoChat(tokenObj,characterObj,macro.get('action'));
                }
            }
            if (isSet(condition.remAPI)) {
                sendCalltoChat(tokenObj,characterObj,condition.remAPI);
            }
            if (isSet(condition.remRoll20AM)) {
                sendCalltoChat(tokenObj,characterObj,condition.remRoll20AM);
            }
            if (isSet(condition.remFX)) {
                doFX(tokenObj,condition.remFX);
            }
        }
    },

    sendCalltoChat = function(tokenObj,characterObj,action) {
        if (!action) {
            return;
        }
        let substitutions = state[combatState].config.macro.substitutions;

        if (substitutions) {
            substitutions.forEach((substitution) => {
                let replaceString = new RegExp(esRE(substitution.action), "g");
                if (substitution.type == 'CharName') {
                    action = action.replace(replaceString, characterObj.get('name'));
                } else if (substitution.type == 'CharID') {
                    action = action.replace(replaceString, characterObj.get('_id'));
                } else if (substitution.type == 'TokenID') {
                    action = action.replace(replaceString, tokenObj.get('_id'));
                } else if (substitution.type == 'PlayerID') {
                    action = action.replace(replaceString, state[combatState].config.gmPlayerID);
                }
            });
        }

        sendChat(tokenObj.get('name'), action, null, {noarchive:true});
    },

    doFX = function (tokenObj, fx) {
        if (tokenObj.get('layer') === 'gmlayer') {
            return;
        }

        let pos = {x: tokenObj.get('left'), y: tokenObj.get('top')};
        spawnFxBetweenPoints(pos, pos, fx, tokenObj.get('pageid'));
    },

    // Looks for a character ability first, then a global macro
    getMacro = function(tokenObj, name) {
        let macro = findObjs({_characterid: tokenObj.get('represents'), _type: 'ability', name: name})[0];
        if (!macro) {
            macro = findObjs({_type: 'macro', name: name})[0];
        }
        return macro;
    },

//*************************************************************************************************************
//SUBSTITUTIONS
//*************************************************************************************************************
    newSubstitution = function(cmdDetails) {
        state[combatState].config.macro.substitutions.push({
            type: cmdDetails.details.type,
            action: cmdDetails.details.action
        });
        sendMacroMenu();
    },

    removeSubstitution = function(cmdDetails) {
        state[combatState].config.macro.substitutions = state[combatState].config.macro.substitutions
            .filter(substitution => substitution.action != cmdDetails.details.action);
        sendMacroMenu();
    },

//*************************************************************************************************************
//SPELLS
//*************************************************************************************************************
    handleSpellCast = function(msg, sheet) {
        if (debug) {
            log('Handle Spell Cast');
            log(msg);
        }

        const status        = state[combatState].config.status;
        const concentration = state[combatState].config.concentration;
        const content       = msg.content || '';
        let spellName       = '';
        let description     = '';
        let concentrate     = false;
        let spellLevel      = '';
        let duration        = 1;
        let characterName   = '';
        let characterID     = '';

        sheet = sheet || status.sheet;

        if (sheet == 'OGL') {
            spellName     = firstMatch(content, [/{{name=([^\n{}]*[^"\n{}])/, /name=([^\n{}]*[^"\n{}])/]);
            description   = firstMatch(content, [/description=([^\n{}]*[^"\n{}])/]);
            spellLevel    = firstMatch(content, [/spelllevel=([^\n{}]*[^"\n{}])/]);
            characterName = firstMatch(content, [/charname=([^\n{}]*[^"\n{}])/]);
            concentrate   = content.includes("{{concentration=1}}");
            if (!spellLevel && !concentrate) {
                return;
            }
        } else if (sheet == 'Shaped') {
            spellName     = firstMatch(content, [/title=([^\n{}]*[^"\n{}])/]);
            description   = firstMatch(content, [/{{content=([^\n{}]*[^"\n{}])/]);
            characterName = firstMatch(content, [/{{character_name=([\w\d ]+[^"\n{}]?)/]);
            const durationMatch = content.match(/duration=[^}\d]*([0-9]+)_([A-Z]+[^"\n{}_ ])/);
            if (durationMatch) {
                const amount = parseInt(durationMatch[1]) || 1;
                if (durationMatch[2].includes('ROUND')) {
                    duration = amount;
                } else if (durationMatch[2].includes('MINUTE')) {
                    duration = amount * 10;
                }
            }
            concentrate = content.includes("CONCENTRATION");
        } else if (sheet == 'PF2') {
            spellName   = firstMatch(content, [/header=([^\n{}]*[^"\n{}])/]);
            description = firstMatch(content, [/desc=([^\n{}]*[^"\n{}])/]);
        } else if (sheet == 'DND2024') {
            const parsed = parse2024SpellCard(msg);
            if (!parsed) {
                return;
            }
            spellName     = parsed.spellName;
            spellLevel    = parsed.spellLevel;
            description   = parsed.description;
            concentrate   = parsed.concentrate;
            duration      = parsed.duration;
            characterName = parsed.characterName;
            characterID   = parsed.characterID;
        }

        // Commas, pipes and braces would break the chat buttons, so they are removed
        spellName = String(spellName || '').replace(/[,|{}]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!spellName) {
            return;
        }

        // One cast can post several chat cards (attack, damage ...). Only react once.
        const castKey = spellName.toLowerCase() + '|' + (characterID || characterName || msg.playerid || '');
        const now = Date.now();
        if (recentSpellCasts[castKey] && now - recentSpellCasts[castKey] < 4000) {
            return;
        }
        recentSpellCasts[castKey] = now;

        description = description || 'None';
        duration    = parseInt(duration) || 1;

        if (debug) {
            log('Sheet:'+sheet+' Spell:'+spellName+' Level:'+spellLevel+' Concentration:'+concentrate+' Duration:'+duration+' Caster:'+(characterID || characterName));
        }

        const key       = spellName.toLowerCase();
        const condition = getConditionByKey(key);
        const direction = (duration >= 1) ? -1 : 0;

        if (typeof condition == 'undefined' && !getIgnoresByKey(key)) {
            state[combatState].spells[key] = makeDefaultCondition(key, spellName, 'Spell', 'red', description, {
                duration: duration,
                direction: direction,
                override: false,
                concentration: concentrate
            });

            let addSpellButton    = makeBigButton('Add Spell to Combat Master', `!cmaster --spell,confirm=true,key=${key}`);
            let ignoreSpellButton = makeBigButton('Ignore this Spell', `!cmaster --spell,confirm=false,key=${key}`);
            makeAndSendMenu(`A new spell (${HE(spellName)}) was detected<br>`+addSpellButton+ignoreSpellButton, 'New Spell Found', 'gm');
        } else if (condition) {
            targetedSpell(key);
            // A spell counts as Concentration if the card says so OR the GM marked the condition
            const needsConcentration = concentrate || condition.concentration == true;
            if (concentration.useConcentration && concentration.autoAdd && needsConcentration && condition.override == false) {
                const tokenObj = findCasterToken(characterID, characterName, msg);
                if (tokenObj) {
                    addConditionToToken(tokenObj,'concentration',condition.duration,condition.direction,'Concentrating on ' + spellName);
                } else {
                    makeAndSendMenu('Could not find a token for <b>' + HE(characterName || characterID || '?') + '</b> to add Concentration.', 'Concentration', 'gm');
                }
            }
        }
    },

    addSpell = function(key) {
        const spell = state[combatState].spells[key];
        if (!spell) {
            makeAndSendMenu('That spell is no longer waiting to be added.', 'Add Spell', 'gm');
            return;
        }
        state[combatState].config.conditions[key] = spell;
        delete state[combatState].spells[key];
        sendConditionMenu(key);
    },

    ignoreSpell = function(key) {
        if (!state[combatState].ignores.includes(key)) {
            state[combatState].ignores.push(key);
        }
        delete state[combatState].spells[key];
        makeAndSendMenu('Spell has been added to Ignore List','Spell Ignored','gm');
    },

    getIgnoresByKey = function(key) {
        return state[combatState].ignores.includes(key);
    },

//*************************************************************************************************************
//CONCENTRATION
//*************************************************************************************************************
    // D&D 2024 rule: DC is 10 or half the damage taken (round down), whichever is higher, max DC 30
    handleConstitutionSave = async function(obj, prev) {
        const concentration = state[combatState].config.concentration;
        if (!obj || !prev || !concentration.useConcentration) {
            return;
        }

        const bar      = String(concentration.woundBar || 'bar1').toLowerCase().replace(/[^a-z0-9]/g, '') + '_value';
        const newValue = parseFloat(obj.get(bar));
        const oldValue = parseFloat(prev[bar]);

        if (!Number.isFinite(newValue) || !Number.isFinite(oldValue) || newValue >= oldValue) {
            return;
        }

        const tokenID = obj.get('id');
        if (!hasCondition(tokenID, 'concentration')) {
            return;
        }

        // The same damage can arrive twice (event + TokenMod observer)
        const checkKey = tokenID + '|' + oldValue + '|' + newValue;
        if (recentConcentrationChecks[checkKey] && Date.now() - recentConcentrationChecks[checkKey] < 1000) {
            return;
        }
        recentConcentrationChecks[checkKey] = Date.now();

        const damage       = oldValue - newValue;
        const DC           = Math.min(30, Math.max(10, Math.floor(damage / 2)));
        const characterObj = getObj('character', obj.get('represents'));
        const name         = HE(obj.get('name') || (characterObj && characterObj.get('name')) || 'Token');

        let saveBonus;
        if (isSet(concentration.attribute) && characterObj) {
            saveBonus = await getSheetNumber(characterObj.id, concentration.attribute);
            if (saveBonus === undefined) {
                warnMissingAttributes(characterObj, [concentration.attribute]);
            }
        }
        const bonusText = (saveBonus !== undefined) ? ` (save bonus ${saveBonus >= 0 ? '+' : ''}${saveBonus})` : '';

        let target = concentration.notify;
        let contents;
        if (target === 'Character') {
            target   = characterObj ? characterObj.get('name') : 'gm';
            contents = 'Make a Constitution saving throw to keep Concentration: <b>DC ' + DC + '</b>' + bonusText + '.';
        } else if (target === 'Everyone') {
            target   = '';
            contents = '<b>'+name+'</b> must make a Constitution saving throw to keep Concentration: <b>DC ' + DC + '</b>' + bonusText + '.';
        } else {
            target   = 'gm';
            contents = '<b>'+name+'</b> must make a Constitution saving throw to keep Concentration: <b>DC ' + DC + '</b>' + bonusText + '.';
        }

        const send = (text) => {
            makeAndSendMenu(text, 'Concentration', target);
            if (target !== '' && target !== 'gm') {
                makeAndSendMenu(text, 'Concentration', 'gm');
            }
        };

        if (!concentration.autoRoll) {
            send(contents);
            return;
        }

        const bonus = saveBonus || 0;
        sendChat('', '[[1d20+(' + bonus + ')]]', (ops) => {
            const roll    = ops && ops[0] && ops[0].inlinerolls && ops[0].inlinerolls[0];
            const total   = (roll && roll.results) ? roll.results.total : 0;
            const success = total >= DC;
            const result  = success ? '<span style="color:green"><b>Success</b></span>' : '<span style="color:red"><b>Failed</b></span>';
            send(contents + '<br>Roll: <b>' + total + '</b> ' + result + (success ? '' : '<br>Concentration can be removed with the trash can in the turn message.'));
        });
    },

//*************************************************************************************************************
//UTILITIES
//*************************************************************************************************************
    inFight = function () {
        return getTurnorder().length > 0;
    },

    updatePR = function (turn, modifier) {
        let turnorder = getTurnorder();

        turnorder.forEach((t, i) => {
            if (turn.id === t.id && turn.custom === t.custom) {
                turnorder[i].pr = parseInt(t.pr) + modifier;
            }
        });

        setTurnorder(turnorder);
    },

    handleLongString = function (str, max=8) {
        str = String(str || '').split(' ')[0];
        return (str.length > max) ? str.slice(0, max) + '...' : str;
    },

    observeTokenChange = function(handler){
        if (typeof handler === 'function') {
            observers.tokenChange.push(handler);
        }
    },

    notifyObservers = function(event,obj,prev){
        (observers[event] || []).forEach(function(handler){
            handler(obj,prev);
        });
    },

    handleGraphicMovement = function (obj) {
        if (!inFight()) {
            return;
        }

        const current = getCurrentTurn();
        if (current && current.id === obj.get('id')) {
            changeMarker(obj);
        }
    },

    // Only used for the 2014 Shaped sheet (legacy attributes)
    handleShapedSheet = function (characterid, condition, add) {
        let character = getObj('character', characterid);
        if (character) {
            let sheet = getAttrByName(character.get('id'), 'character_sheet', 'current');
            if (!sheet || !sheet.toLowerCase().includes('shaped')) {
                return;
            }
            if (!shaped_conditions.includes(condition)) {
                return;
            }

            let attributes = {};
            attributes[condition] = (add) ? '1': '0';
            setAttrs(character.get('id'), attributes);
        }
    },

    esRE = function (s) {
        var escapeForRegexp = /(\\|\/|\[|\]|\(|\)|\{|\}|\?|\+|\*|\||\.|\^|\$)/g;
        return String(s).replace(escapeForRegexp,"\\$1");
    },

    HE = (function(){
        var entities={
                '<' : '&'+'lt'+';',
                '>' : '&'+'gt'+';',
                "'" : '&'+'#39'+';',
                '@' : '&'+'#64'+';',
                '{' : '&'+'#123'+';',
                '|' : '&'+'#124'+';',
                '}' : '&'+'#125'+';',
                '[' : '&'+'#91'+';',
                ']' : '&'+'#93'+';',
                '"' : '&'+'quot'+';',
                "&" : '&'+'amp'+';'
            },
            re=new RegExp('('+Object.keys(entities).map(esRE).join('|')+')','g');
        return function(s){
            return String(s).replace(re, function(c){ return entities[c] || c; });
        };
    }()),

    ucFirst = function (string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

//*************************************************************************************************************
//DEFAULTS
//*************************************************************************************************************
    makeDefaultCondition = function (key, name, type, icon, description, extra = {}) {
        return Object.assign({
            name: name,
            key: key,
            type: type,
            description: description,
            icon: icon,
            iconType: 'Combat Master',
            duration: 1,
            direction: -1,
            override: true,
            favorite: false,
            message: 'None',
            targeted: false,
            targetedAPI: 'casterTargets',
            concentration: false,
            addAPI: 'None',
            addRoll20AM: 'None',
            addFX: 'None',
            addMacro: 'None',
            addPersistentMacro: false,
            remAPI: 'None',
            remRoll20AM: 'None',
            remFX: 'None',
            remMacro: 'None',
        }, extra);
    },

    // Condition rules follow the D&D 2024 rules (System Reference Document 5.2, CC-BY-4.0)
    getDefaultConditions = function () {
        const c = makeDefaultCondition;
        return {
            blinded: c('blinded', 'Blinded', 'Condition', 'bleeding-eye',
                '<p><b>Can\'t see.</b> You can\'t see and automatically fail any ability check that requires sight.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage, and your attack rolls have Disadvantage.</p>'),
            charmed: c('charmed', 'Charmed', 'Condition', 'broken-heart',
                '<p><b>Can\'t harm the charmer.</b> You can\'t attack the charmer or target the charmer with damaging abilities or magical effects.</p><p><b>Social advantage.</b> The charmer has Advantage on any ability check to interact with you socially.</p>'),
            concentration: c('concentration', 'Concentration', 'Spell', 'trophy',
                '<p>You are keeping a spell or effect going. It ends if you cast another Concentration spell, become Incapacitated, die, or choose to end it. When you take damage, make a Constitution saving throw: DC 10 or half the damage taken (round down), whichever is higher, up to DC 30.</p>',
                { direction: 0 }),
            deafened: c('deafened', 'Deafened', 'Condition', 'edge-crack',
                '<p><b>Can\'t hear.</b> You can\'t hear and automatically fail any ability check that requires hearing.</p>'),
            exhaustion: c('exhaustion', 'Exhaustion', 'Condition', 'snail',
                '<p><b>Levels.</b> Exhaustion stacks. Use the Duration as the Exhaustion level (1 to 6). At level 6 you die.</p><p><b>D20 Tests affected.</b> Subtract twice your Exhaustion level from every D20 Test.</p><p><b>Speed reduced.</b> Your Speed is reduced by 5 feet times your Exhaustion level.</p><p><b>Removing levels.</b> Finishing a Long Rest removes 1 level.</p>',
                { direction: 0 }),
            frightened: c('frightened', 'Frightened', 'Condition', 'screaming',
                '<p><b>Ability checks and attacks affected.</b> You have Disadvantage on ability checks and attack rolls while the source of fear is within line of sight.</p><p><b>Can\'t approach.</b> You can\'t willingly move closer to the source of fear.</p>'),
            grappled: c('grappled', 'Grappled', 'Condition', 'grab',
                '<p><b>Speed 0.</b> Your Speed is 0 and can\'t increase.</p><p><b>Attacks affected.</b> You have Disadvantage on attack rolls against any target other than the grappler.</p><p><b>Movable.</b> The grappler can drag or carry you when it moves, but every foot of movement costs it 1 extra foot unless you are Tiny or two or more sizes smaller than it.</p>'),
            incapacitated: c('incapacitated', 'Incapacitated', 'Condition', 'interdiction',
                '<p><b>Inactive.</b> You can\'t take any action, Bonus Action, or Reaction.</p><p><b>No Concentration.</b> Your Concentration is broken.</p><p><b>Speechless.</b> You can\'t speak.</p><p><b>Surprised.</b> If you are Incapacitated when you roll Initiative, you have Disadvantage on the roll.</p>'),
            inspiration: c('inspiration', 'Heroic Inspiration', 'Spell', 'black-flag',
                '<p>If you have Heroic Inspiration, you can expend it to reroll any die immediately after rolling it, and you must use the new roll. You can only have one instance of Heroic Inspiration at a time.</p>',
                { direction: 0 }),
            invisible: c('invisible', 'Invisible', 'Condition', 'ninja-mask',
                '<p><b>Surprise.</b> If you are Invisible when you roll Initiative, you have Advantage on the roll.</p><p><b>Concealed.</b> You aren\'t affected by any effect that requires its target to be seen unless the effect\'s creator can somehow see you. Any equipment you are wearing or carrying is also concealed.</p><p><b>Attacks affected.</b> Attack rolls against you have Disadvantage, and your attack rolls have Advantage. If a creature can somehow see you, you don\'t gain this benefit against that creature.</p>'),
            paralyzed: c('paralyzed', 'Paralyzed', 'Condition', 'pummeled',
                '<p><b>Incapacitated.</b> You have the Incapacitated condition.</p><p><b>Speed 0.</b> Your Speed is 0 and can\'t increase.</p><p><b>Saving throws affected.</b> You automatically fail Strength and Dexterity saving throws.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage.</p><p><b>Automatic critical hits.</b> Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.</p>'),
            petrified: c('petrified', 'Petrified', 'Condition', 'frozen-orb',
                '<p><b>Turned to inanimate substance.</b> You and any nonmagical objects you are wearing or carrying are transformed into a solid inanimate substance (usually stone). Your weight increases by a factor of ten, and you cease aging.</p><p><b>Incapacitated.</b> You have the Incapacitated condition.</p><p><b>Speed 0.</b> Your Speed is 0 and can\'t increase.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage.</p><p><b>Saving throws affected.</b> You automatically fail Strength and Dexterity saving throws.</p><p><b>Resist damage.</b> You have Resistance to all damage.</p><p><b>Poison immunity.</b> You have Immunity to the Poisoned condition.</p>'),
            poisoned: c('poisoned', 'Poisoned', 'Condition', 'chemical-bolt',
                '<p><b>Ability checks and attacks affected.</b> You have Disadvantage on attack rolls and ability checks.</p>'),
            prone: c('prone', 'Prone', 'Condition', 'back-pain',
                '<p><b>Restricted movement.</b> Your only movement options are to crawl or to spend an amount of movement equal to half your Speed (round down) to right yourself and end the condition. If your Speed is 0, you can\'t right yourself.</p><p><b>Attacks affected.</b> You have Disadvantage on attack rolls. An attack roll against you has Advantage if the attacker is within 5 feet of you. Otherwise, that attack roll has Disadvantage.</p>'),
            restrained: c('restrained', 'Restrained', 'Condition', 'fishing-net',
                '<p><b>Speed 0.</b> Your Speed is 0 and can\'t increase.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage, and your attack rolls have Disadvantage.</p><p><b>Saving throws affected.</b> You have Disadvantage on Dexterity saving throws.</p>'),
            stunned: c('stunned', 'Stunned', 'Condition', 'fist',
                '<p><b>Incapacitated.</b> You have the Incapacitated condition.</p><p><b>Saving throws affected.</b> You automatically fail Strength and Dexterity saving throws.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage.</p>'),
            unconscious: c('unconscious', 'Unconscious', 'Condition', 'sleepy',
                '<p><b>Inert.</b> You have the Incapacitated and Prone conditions, and you drop whatever you are holding. When this condition ends, you remain Prone.</p><p><b>Speed 0.</b> Your Speed is 0 and can\'t increase.</p><p><b>Attacks affected.</b> Attack rolls against you have Advantage.</p><p><b>Saving throws affected.</b> You automatically fail Strength and Dexterity saving throws.</p><p><b>Automatic critical hits.</b> Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you.</p><p><b>Unaware.</b> You are unaware of your surroundings.</p>'),
        };
    },

    getCombatDefaults = function () {
        return {
            conditions: [],
            ignores: [],
            spells: {},
            markerIds: {current: null, next: null},
            config: {
                command: 'cmaster',
                duration: false,
                favorite: false,
                previousPage: null,
                gmPlayerID: null,
                hold: {
                    held: false,
                    turnorder: [],
                    conditions: [],
                    round: 1
                },
                initiative: {
                    rollInitiative: 'CombatMaster',
                    initiativeDie: 20,
                    initiativeAttributes: 'initiative_bonus',
                    showInitiative: false,
                    rollEachRound: false,
                    apiTargetTokens: 'None'
                },
                turnorder: {
                    useMarker: true,
                    markerType: 'External URL',
                    externalMarkerURL: 'https://s3.amazonaws.com/files.d20.io/images/52550079/U-3U950B3wk_KRtspSPyuw/thumb.png?1524507826',
                    nextMarkerType: 'External URL',
                    nextExternalMarkerURL: 'https://s3.amazonaws.com/files.d20.io/images/66352183/90UOrT-_Odg2WvvLbKOthw/thumb.png?1541422636',
                    tokenMarkerName: 'None',
                    tokenMarkerURL: null,
                    nextTokenMarkerName: 'None',
                    nextTokenMarkerURL: null,
                    markerSize: 1.35,
                    animateMarker: false,
                    animateMarkerDegree: 15,
                    animateMarkerWait: 250,
                    sortTurnOrder: true,
                    centerToken: true,
                    turnAPI: 'None',
                    turnRoll20AM: 'None',
                    turnFX: 'None',
                    turnMacro: 'None',
                    roundAPI: 'None',
                    roundRoll20AM: 'None',
                    roundFX: 'None',
                    roundMacro: 'None',
                    characterRoundMacro: 'None',
                    allRoundMacro: 'None',
                },
                timer: {
                    useTimer: false,
                    time: 120,
                    skipTurn: true,
                    sendTimerToChat: true,
                    showTokenTimer: true,
                    timerFont: 'Candal',
                    timerFontSize: 16,
                    timerFontColor: 'rgb(255, 0, 0)'
                },
                announcements: {
                    announceTurn: true,
                    whisperToGM: false,
                    announceRound: true,
                    handleLongName: true,
                    showNPCTurns: false,
                },
                macro: {
                    substitutions: [],
                },
                status: {
                    userAllowed: false,
                    userChanges: false,
                    sendOnlyToGM: false,
                    sendConditions: true,
                    clearConditions: false,
                    showConditions: 'all',
                    useMessage: false,
                    access: 'None',
                    autoAddSpells: false,
                    sheet: 'Auto',
                    logRolls: false,
                },
                concentration: {
                    useConcentration: false,
                    notify: 'GM',
                    autoAdd: false,
                    autoRoll: false,
                    woundBar: 'bar1',
                    attribute: 'constitution_save_mod',
                    breakOnIncapacitated: true
                },
                conditions: getDefaultConditions(),
            },
        };
    },

    isPlainObject = function (value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    },

    // Adds any missing settings without touching the ones the GM already changed.
    // (Replaces ~300 lines of hand written hasOwnProperty checks.)
    fillDefaults = function (target, defaults, skipKeys = []) {
        Object.keys(defaults).forEach((key) => {
            if (skipKeys.includes(key)) {
                return;
            }
            if (!Object.prototype.hasOwnProperty.call(target, key) || target[key] === undefined) {
                target[key] = JSON.parse(JSON.stringify(defaults[key]));
            } else if (isPlainObject(defaults[key]) && isPlainObject(target[key])) {
                fillDefaults(target[key], defaults[key]);
            }
        });
    },

    setDefaults = function (reset) {
        const combatDefaults = getCombatDefaults();

        if (!state[combatState].config || reset) {
            state[combatState].config = combatDefaults.config;
        } else {
            // "conditions" is skipped so conditions the GM deleted do not come back
            fillDefaults(state[combatState].config, combatDefaults.config, ['conditions']);
        }

        const config = state[combatState].config;

        // Old versions stored the wound bar as "Bar1", which never matched the Roll20 event name
        config.concentration.woundBar = String(config.concentration.woundBar || 'bar1').toLowerCase();

        if (!Array.isArray(state[combatState].conditions)) {
            state[combatState].conditions = [];
        }
        if (!Array.isArray(state[combatState].ignores)) {
            state[combatState].ignores = [];
        }
        // Old versions used an array here but stored spells by name, so convert it to an object
        if (!isPlainObject(state[combatState].markerIds)) {
            state[combatState].markerIds = {current: null, next: null};
        }
        // 2.50 stored the 2024 sheet option as "DnD2024"
        if (config.status.sheet === 'DnD2024') {
            config.status.sheet = 'DND2024';
        }
        if (!isPlainObject(state[combatState].spells)) {
            state[combatState].spells = {};
        }

        if (!isPlainObject(config.conditions)) {
            config.conditions = getDefaultConditions();
        }

        const conditionDefaults = makeDefaultCondition('', '', 'Condition', 'red', ' ', { direction: 0 });
        Object.keys(config.conditions).forEach((key) => {
            const condition = config.conditions[key];
            fillDefaults(condition, conditionDefaults, ['name', 'key']);
            if (!condition.key) {
                condition.key = key;
            }
            if (!condition.name) {
                condition.name = key;
            }
        });

        if (!config.conditions.concentration && config.concentration.useConcentration) {
            config.conditions.concentration = getDefaultConditions().concentration;
        }
    },

//*************************************************************************************************************
//HELP HANDOUTS
//*************************************************************************************************************
    showHelp = function(cmdDetails) {
        const titles = {
            held: 'Main Menu Held',
            started: 'Main Menu Started',
            stopped: 'Main Menu Stopped',
            setup: 'Setup Menu',
            initiative: 'Initiative Menu',
            turnorder: 'Turnorder Menu',
            timer: 'Timer Menu',
            announcements: 'Announcements Menu',
            macro: 'Macro & API Menu',
            status: 'Status Menu',
            concentration: 'Concentration Menu',
            conditions: 'Conditions Menu',
            condition: 'Condition Menu',
            addAPI: 'Add API Menu',
            remAPI: 'Remove API Menu',
            export: 'Export Menu'
        };
        const found = Object.keys(titles).find(k => cmdDetails.details[k]);
        const title = found ? titles[found] : 'Setup Menu';
        const handout = findHandout(title);
        if (!handout[0]) {
            makeAndSendMenu('Help handout not found. Restart the sandbox to rebuild it.', title, 'gm');
            return;
        }
        makeAndSendMenu(`<a href="http://journal.roll20.net/handout/${handout[0].id}">View Help</a>`,title,'gm');
    },

    buildHelp = function() {
        let mainStarted       = createHandout('Main Menu Started');
        let mainStopped       = createHandout('Main Menu Stopped');
        let mainHeld          = createHandout('Main Menu Held');
        let menuSetup         = createHandout('Setup Menu');
        let menuInitiative    = createHandout('Initiative Menu');
        let menuTurnorder     = createHandout('Turnorder Menu');
        let menuTimer         = createHandout('Timer Menu');
        let menuAnnouncements = createHandout('Announcements Menu');
        let menuMacro         = createHandout('Macro & API Menu');
        let menuStatus        = createHandout('Status Menu');
        let menuConcentration = createHandout('Concentration Menu');
        let menuConditions    = createHandout('Conditions Menu');
        let menuCondition     = createHandout('Condition Menu');
        let menuAddAPI        = createHandout('Add API Menu');
        let menuRemoveAPI     = createHandout('Remove API Menu');
        let menuExport        = createHandout('Export Menu');

        setTimeout(function() {
            buildMainMenuStarted(mainStarted,menuSetup.id,menuCondition.id);
            buildMainMenuStopped(mainStopped,menuSetup.id,menuCondition.id);
            buildMainMenuHeld(mainHeld,menuSetup.id,menuCondition.id);
            buildSetupMenu(menuSetup,menuInitiative.id,menuTurnorder.id,menuTimer.id,menuAnnouncements.id,menuMacro.id,menuStatus.id,menuConcentration.id,menuConditions.id,menuExport.id);
            buildInitiativeMenu(menuInitiative);
            buildTurnorderMenu(menuTurnorder);
            buildTimerMenu(menuTimer);
            buildAnnouncementsMenu(menuAnnouncements);
            buildMacroMenu(menuMacro);
            buildStatusMenu(menuStatus);
            buildConcentrationMenu(menuConcentration);
            buildConditionsMenu(menuConditions,menuCondition.id);
            buildConditionMenu(menuCondition);
            buildAddAPIMenu(menuAddAPI);
            buildRemoveAPIMenu(menuRemoveAPI);
            buildExportMenu(menuExport);
        },1000);
    },

    findHandout = function (title) {
        return findObjs({_type:'handout', name:title});
    },

    createHandout = function (title) {
        findHandout(title).forEach(h => h.remove());
        return createObj('handout', {
            name: title,
            archived: true
        });
    },

    buildMainMenuStarted = function(handout,setupID,conditionID) {
        let notes = `<div class="content note-editor notes">
                    <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155102/i5BnjEmv8VSsfpoK44jaKw/original.png?15953856105"></p>
                    <h4><i>Started Combat (Green Bar)</i>: Icons in order from Left to Right</h4>
                    <ul>
                        <li><b>Stop Combat:</b> Ends Combat and clears Turnorder.</li>
                        <li><b>Hold Combat:</b> Sets Combat to Hold and saves everything for a restart.</li>
                        <li><b>Previous Player:</b> Sets Active Player to previous player in Turnorder.</li>
                        <li><b>Next Player:</b> Sets Active Player to Next Player in Turnorder.</li>
                        <li><b>Pause Timer:</b> Pauses Timer. Click again to restart Timer.</li>
                        <li><b>Stop Timer:</b> Stops and clears the Timer until the next Combat.</li>
                        <li><b>Show Conditions:</b> Shows all Conditions assigned to the selected tokens.</li>
                        <li><b>Sort Turnorder:</b> Sorts the Turnorder from highest to lowest.</li>
                        <li><b>Setup:</b> Shows the <a href="http://journal.roll20.net/handout/${setupID}">Setup Menu</a></li>
                    </ul>`;
        notes += buildMainConditions(conditionID);
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildMainMenuStopped = function(handout,setupID,conditionID) {
        let notes = `<div class="content note-editor notes">
                    <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155096/Yb0jQ-AqPsjXPAN4F0OHVA/original.png?15953856105"></p>
                    <h4><i>Start Combat (Red Bar)</i>: Icons in order from Left to Right</h4>
                    <ul>
                        <li><b>Start Combat:</b> Starts combat. Select tokens first if CombatMaster rolls initiative.</li>
                        <li><b>Setup:</b> Shows the <a href="http://journal.roll20.net/handout/${setupID}">Setup Menu</a>.</li>
                    </ul>`;
        notes += buildMainConditions(conditionID);
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildMainMenuHeld = function(handout,setupID,conditionID) {
        let notes = `<div class="content note-editor notes">
                    <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155100/DcEfpVBdzKz9t-SS23KZhA/original.png?15953856105"></p>
                    <h4><i>Held Combat (Yellow Bar)</i>: Icons in order from Left to Right</h4>
                    <ul>
                        <li><b>Start Combat:</b> Restarts Combat from where it was held.</li>
                        <li><b>Setup:</b> Shows the <a href="http://journal.roll20.net/handout/${setupID}">Setup Menu</a>.</li>
                    </ul>`;
        notes += buildMainConditions(conditionID);
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildMainConditions = function(conditionID) {
        return `<h4><i>Conditions</i>: From Left to Right</h4>
                <ul>
                    <li><b>Icon:</b> The marker assigned to the condition. Token Condition conditions show "TC".</li>
                    <li><b>Name:</b> The name of the condition.</li>
                    <li><b>Add:</b> Adds the condition to the selected token(s) and runs any API commands or Macros assigned to it.</li>
                    <li><b>Remove:</b> Removes the condition from the selected token(s).</li>
                    <li><b>Favorite:</b> Star means it shows in Favorites. Globe means it only shows in All. Click to toggle.</li>
                    <li><b>Edit:</b> Shows the <a href="http://journal.roll20.net/handout/${conditionID}">Condition Menu</a> for that condition.</li>
                </ul>
                <h4><i>Change View</i></h4>
                <ul>
                    <li><b>All:</b> Shows all Spells and Conditions</li>
                    <li><b>Conditions:</b> Shows all Conditions (Type = Condition)</li>
                    <li><b>Spells:</b> Shows all Spells (Type = Spell)</li>
                    <li><b>Favorites:</b> Shows all Favorites</li>
                </ul>`;
    },

    buildSetupMenu = function(handout,initiativeID,turnorderID,timerID,announceID,macroID,statusID,concentrationID,conditionsID,exportID) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155095/jC-VGZKJY2kweDvEfeIKRA/original.png?15953856105"></p>
                        <p><b>D&amp;D 2024 by Roll20:</b> set <i>API Sandbox Version</i> to <b>Experimental</b>, otherwise sheet values cannot be read.</p>
                        <h4><i>Combat Setup</i></h4>
                        <ul>
                            <li><b><a href="http://journal.roll20.net/handout/${initiativeID}">Initiative</a>:</b> How CombatMaster rolls Initiative.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${turnorderID}">Turnorder</a>:</b> How the turnorder is managed.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${timerID}">Timer</a>:</b> A turn timer and how it is displayed.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${announceID}">Announce</a>:</b> How turns are announced in chat.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${macroID}">Macro &amp; API</a>:</b> Substitution strings for macros and API commands.</li>
                        </ul>
                        <h4><i>Status Setup</i></h4>
                        <ul>
                            <li><b><a href="http://journal.roll20.net/handout/${statusID}">Status</a>:</b> How conditions are managed and displayed.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${concentrationID}">Concentration</a>:</b> How Concentration is managed.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${conditionsID}">Conditions</a>:</b> Edit existing conditions or add new ones.</li>
                            <li><b><a href="http://journal.roll20.net/handout/${exportID}">Export</a>:</b> Puts a configuration code in chat to copy into another game.</li>
                            <li><b>Import:</b> Import a configuration from another game.</li>
                        </ul>
                        <h4><i>Resets</i></h4>
                        <ul>
                            <li><b>Reset:</b> Resets everything. Conditions go back to the D&amp;D 2024 defaults.</li>
                            <li><b>Remove Ignores:</b> Removes all Spells from the ignore list.</li>
                            <li><b>Clear Token Statuses:</b> Removes all markers from the selected tokens.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildInitiativeMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155099/rjAlxljzxTzHNp94R3FQaQ/original.png?15953856105"></p>
                        <h4><i>Initiative Setup</i></h4>
                        <ul>
                            <li><b>None:</b> CombatMaster does not roll. The turn order must be filled before starting combat.</li>
                            <li><b>CombatMaster:</b> Select the tokens, then click Start.
                                <ul>
                                    <li><b>Roll Each Round:</b> Rerolls initiative at the end of each round.</li>
                                    <li><b>Initiative Attr:</b> Comma separated list of sheet values that are added together. <b>D&amp;D 2024 by Roll20:</b> <code>initiative_bonus</code> (add <code>init_tiebreaker</code> if you want tie breaks). <b>D&amp;D 2014 OGL:</b> <code>initiative_bonus</code>.</li>
                                    <li><b>Initiative Die:</b> The die CombatMaster rolls for each character.</li>
                                    <li><b>Show Initiative in Chat:</b> Displays the initiative rolls in chat.</li>
                                </ul>
                            </li>
                            <li><b>Group-Init:</b> Uses the GroupInitiative script. It must be installed and configured separately. For the 2024 sheet use <code>!group-init --add-group --computed initiative_bonus</code>.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildTurnorderMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155089/ITDSxgaL_xtJ7w_jiNg0gA/original.png?15953856105"></p>
                        <h4><i>Turnorder Setup</i></h4>
                        <ul>
                            <li><b>Sort Turnorder:</b> Sorts the turnorder from highest to lowest once created.</li>
                            <li><b>Center Map on Token:</b> Pings the active token for all players (not for tokens on the GM Layer).</li>
                            <li><b>Use Marker:</b> Shows the marker to players. It moves to the GM Layer for tokens on the GM Layer.</li>
                            <li><b>Marker Type:</b> External URL (default) or Token Marker.</li>
                            <li><b>Marker:</b> The image that highlights the active character.</li>
                            <li><b>Use Next Marker:</b> A second marker for the character that is up next. Set to None if you don't need it.</li>
                        </ul>`;
        notes += buildExternalCallMenu('<b>Beginning of Each Round</b>', true);
        notes += buildExternalCallMenu('<b>Beginning of Each Turn</b>');
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildExternalCallMenu = function(title,round,condition) {
        let notes = `<h4><i>${title}</i></h4>
                     <h5><i>External calls that will be run</i></h5>
                    <ul>
                        <li><b>API:</b> A full API command. Use {{ and }} around the command. Inline rolls must be written like [#[1d6]#] instead of [[1d6]].</li>
                        <li><b>Roll20AM:</b> A full Roll20AM command. Use {{ and }} around the command.</li>
                        <li><b>FX:</b> A valid FX name.</li>`;
        if (round) {
            notes += `<li><b>Characters Macro:</b> A macro run for every player character in the turn order.</li>
                      <li><b>All Tokens Macro:</b> A macro run for every token in the turn order.</li>`;
        } else {
            notes += `<li><b>Macro:</b> The macro or character ability name (without the #). Inline rolls must be written like [#[1d6]#].</li>`;
        }
        if (condition) {
            notes += `<li><b>Persistent Macro:</b> Repeats the macro at the start of the affected token's turn.</li>`;
        }
        notes += `</ul>`;
        return notes;
    },

    buildTimerMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155088/xni0bvuiAktNfbrTbUAPog/original.png?15953856105"></p>
                        <h4><i>Timer Setup</i></h4>
                        <ul>
                            <li><b>Turn Timer:</b> Turns on the turn timer.</li>
                            <li><b>Time:</b> Seconds per turn.</li>
                            <li><b>Skip Turn:</b> Moves to the next turn when the timer reaches 0.</li>
                            <li><b>Send to Chat:</b> Sends alerts at the start, halfway, quarter, 10 and 5 seconds.</li>
                            <li><b>Show on Token:</b> Shows the timer under the active token.</li>
                            <li><b>Token Font / Font Size:</b> Font settings for the timer text.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildAnnouncementsMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155098/7i1LPHIZ87fVB56cUMcvhw/original.png?15953856105"></p>
                        <h4><i>Announcements Setup</i></h4>
                        <ul>
                            <li><b>Announce Rounds:</b> Sends a message when a new round starts.</li>
                            <li><b>Announce Turns:</b> Sends a message with the active token, its conditions and messages. The down arrow delays the turn, the check box ends it, the condition name shows its description, and the trash can removes it.</li>
                            <li><b>Whisper GM Only:</b> All announcements only go to the GM.</li>
                            <li><b>Shorten Long Names:</b> Shortens token names in turn announcements.</li>
                            <li><b>Show NPC Conditions:</b> If false, NPC turn announcements only go to the GM.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    substitutionHelp = `<p>Substitution strings replace a placeholder in your macros and API commands. Example: if a macro normally uses @{selected|character_id}, create a CharID substitution such as 'charidentifier' and use that word in the macro instead.</p><p>Use unique words that do not appear anywhere else in the command. The PlayerID substitution is meant for TokenMod:</p><pre>!token-mod --api-as playeridentifier --ids tokenidentifier --on showname</pre>`,

    buildMacroMenu = function(handout) {
        let notes = `<div class="content note-editor notes">${substitutionHelp}
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155094/0ZAC_3VwnVxEL_ZLfgo-iA/original.png?15953856105"></p>
                        <h4><i>Macro &amp; API Setup</i></h4>
                        <ul>
                            <li><b>Type:</b> The type of value being substituted.</li>
                            <li><b>String:</b> The placeholder word.</li>
                            <li><b>Delete:</b> Deletes that substitution.</li>
                            <li><b>Add Substitution:</b> Creates a new substitution.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildStatusMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155103/WF7QJJUMbfTjTjPWyd8SYQ/original.png?15953856105"></p>
                        <h4><i>Status Setup</i></h4>
                        <ul>
                            <li><b>Whisper GM Only:</b> Condition descriptions only go to the GM.</li>
                            <li><b>Player Allowed Changes:</b> The active player gets a menu to add or remove conditions on their token.</li>
                            <li><b>Send Changes to Chat:</b> Sends the description when a condition is added.</li>
                            <li><b>Clear Conditions on Close:</b> Stopping combat removes all conditions.</li>
                            <li><b>Use Messages:</b> Asks for a message whenever a condition is added.</li>
                            <li><b>Auto Add Spells:</b> Detects spells cast from the sheet and offers to add them.</li>
                            <li><b>Sheet:</b> Auto (reads 2014 OGL and 2024 cards), DND2024 (D&amp;D 2024 by Roll20), OGL (D&amp;D 2014), Shaped, PF2. The 2024 roll cards are still changing on Roll20, so detection may need adjusting.</li>
                            <li><b>Log Raw Rolls (debug):</b> Writes every chat message to the Mod console so you can see what the sheet sends.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildConcentrationMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155091/gy3wl9H_uHBHWeQXcRk5cw/original.png?15953856105"></p>
                        <h4><i>Concentration Setup</i></h4>
                        <ul>
                            <li><b>Use Concentration:</b> Turns on Concentration handling.</li>
                            <li><b>Add Marker on Cast:</b> When a known Concentration spell is cast from the sheet, the Concentration marker is put on the caster.</li>
                            <li><b>Wound Bar:</b> The token bar that tracks hit points (usually bar1). When it goes down on a concentrating token, the save DC is posted (10 or half the damage, max 30).</li>
                            <li><b>Notify:</b> Who gets told about the save.</li>
                            <li><b>Roll Save Automatically:</b> CombatMaster rolls the Constitution save and shows Success or Failed.</li>
                            <li><b>Save Bonus Attr:</b> Sheet value with the Constitution save bonus. Default <code>constitution_save_mod</code> (2014 OGL and 2024). Set to None to skip.</li>
                            <li><b>End on Incapacitated:</b> 2024 rule. Adding Incapacitated, Paralyzed, Petrified, Stunned or Unconscious removes Concentration.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildConditionsMenu = function(handout,conditionID) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155101/zyFZLPVbsoAT7a1CI9bVEg/original.png?15953856105"></p>
                        <h4><i>Conditions Menu</i></h4>
                        <ul>
                            <li><b>Icon:</b> The marker used by the condition. Token Condition shows "TC".</li>
                            <li><b>Name:</b> The name of the condition.</li>
                            <li><b>Edit:</b> Shows the <a href="http://journal.roll20.net/handout/${conditionID}">Condition Menu</a>.</li>
                            <li><b>Add Condition:</b> Asks for a name, then opens the new condition.</li>
                        </ul>
                    </div>`;
        handout.set({notes:notes});
    },

    buildConditionMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155092/bngB_blWo6C8bSBvU6ytGw/original.png?15953856105"></p>
                        <h4><i>Condition Menu</i></h4>
                        <ul>
                            <li><b>Name:</b> The name of the condition.</li>
                            <li><b>Type:</b> Spell or Condition. Use Spell for concentration spells.</li>
                            <li><b>Icon Type:</b> Combat Master (Roll20 default markers), Token Marker (needs libTokenMarkers), Token Condition (needs TokenCondition).</li>
                            <li><b>Icon:</b> The marker. Click to change.</li>
                            <li><b>Duration:</b> How long the condition lasts. For Exhaustion, use it as the level.</li>
                            <li><b>Direction:</b> How much the duration changes each round. Negative counts down, 0 is permanent.</li>
                            <li><b>Override:</b> If true, you are asked for duration and direction when adding the condition.</li>
                            <li><b>Favorites:</b> Shows the condition in the Favorites view.</li>
                            <li><b>Message:</b> A default message shown with the condition. Use {{ and }} if it contains commas.</li>
                            <li><b>Targeted:</b> The condition is placed on other tokens but counts down on the caster's turn.</li>
                            <li><b>Concentration:</b> The spell requires Concentration.</li>
                            <li><b>Add API / Remove API:</b> External calls when the condition is added or removed.</li>
                            <li><b>Edit Description:</b> Use {{ and }} if the description contains commas.</li>
                            <li><b>Delete Condition:</b> Deletes the condition from CombatMaster.</li>
                        </ul>
                     </div>`;
        handout.set({notes:notes});
    },

    buildAddAPIMenu = function(handout) {
        let notes = `<div class="content note-editor notes">${substitutionHelp}
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155097/fpdZk-v1a2C7miDJmJ1NIA/original.png?15953856105"></p>`;
        notes += buildExternalCallMenu('<b>Add API</b>', false, true);
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildRemoveAPIMenu = function(handout) {
        let notes = `<div class="content note-editor notes">${substitutionHelp}
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155093/xt61MIhDuu93ZCOu7Tt8xA/original.png?15953856105"></p>`;
        notes += buildExternalCallMenu('<b>Remove API</b>');
        notes += `</div>`;
        handout.set({notes:notes});
    },

    buildExportMenu = function(handout) {
        let notes = `<div class="content note-editor notes">
                        <p><img src="https://s3.amazonaws.com/files.d20.io/images/152155090/ilEH0Pon0ovgR1LMmKEAag/original.png?15953856105"></p>
                        <h4><i>Export Menu</i></h4>
                        <p>Copy this configuration code to import your conditions and settings into another game with CombatMaster. Triple click the code to select all of it. Save it in a handout or a file.</p>
                        <p><b>NOTE:</b> <i>From CombatMaster, the whole configuration is copied. From CombatTracker, only the conditions are copied. StatusInfo is not supported.</i></p>
                    </div>`;
        handout.set({notes:notes});
    },

//*************************************************************************************************************
//INSTALL
//*************************************************************************************************************
    checkInstall = function () {
        if (!state[combatState]) {
            state[combatState] = {};
        }
        setDefaults();
        buildHelp();

        const hasSheetItem = (typeof getSheetItem === 'function');
        log(`-=> ${script_name} v${version} Ready! Command: !cmaster --main | ${hasSheetItem ? 'Beacon sheet access available' : 'getSheetItem NOT available'} <=-`);

        // Warn the GM once if 2024 characters exist but the sandbox cannot read them
        if (!hasSheetItem && findObjs({_type: 'character'}).some(c => isBeaconCharacter(c))) {
            setTimeout(() => {
                makeAndSendMenu('This game has <b>D&amp;D 2024</b> characters, but the Mod sandbox cannot read them.<br>Go to Settings, Mod (API) Scripts, set <b>API Sandbox Version</b> to <b>Experimental</b> and restart the sandbox.', 'CombatMaster Warning', 'gm');
            }, 3000);
        }
    },

    registerEventHandlers = function() {
        const safe = (where, fn) => (obj, prev) => {
            try {
                const result = fn(obj, prev);
                if (result && typeof result.catch === 'function') {
                    result.catch(err => reportError(where, err));
                }
            } catch (err) {
                reportError(where, err);
            }
        };

        on('chat:message', inputHandler);
        on('change:campaign:turnorder', safe('Turnorder', handleTurnorderChange));
        on('change:graphic:statusmarkers', safe('Status Markers', handleStatusMarkerChange));
        on('change:graphic:top', safe('Movement', handleGraphicMovement));
        on('change:graphic:left', safe('Movement', handleGraphicMovement));
        on('change:graphic:layer', safe('Movement', handleGraphicMovement));
        // All bars are watched, so changing the Wound Bar setting works without a restart
        ['bar1', 'bar2', 'bar3'].forEach(bar => {
            on('change:graphic:' + bar + '_value', safe('Concentration Check', handleConstitutionSave));
        });

        if ('undefined' !== typeof DeathTracker && DeathTracker.ObserveTokenChange) {
            DeathTracker.ObserveTokenChange(safe('DeathTracker', handleStatusMarkerChange));
        }

        if ('undefined' !== typeof InspirationTracker && InspirationTracker.ObserveTokenChange) {
            InspirationTracker.ObserveTokenChange(safe('InspirationTracker', handleStatusMarkerChange));
        }

        if ('undefined' !== typeof TokenMod && TokenMod.ObserveTokenChange) {
            TokenMod.ObserveTokenChange(safe('TokenMod', (obj, prev) => {
                handleStatusMarkerChange(obj, prev);
                return handleConstitutionSave(obj, prev);
            }));
        }
    };

    return {
        CheckInstall: checkInstall,
        RegisterEventHandlers: registerEventHandlers,
        ObserveTokenChange: observeTokenChange,
        addConditionToToken,
        removeConditionFromToken,
        addTargetsToCondition,
        getConditions,
        getConditionByKey,
        sendConditionToChat,
        getDefaultIcon
    };
})();

on('ready',function() {
    'use strict';

    CombatMaster.CheckInstall();
    CombatMaster.RegisterEventHandlers();
});
