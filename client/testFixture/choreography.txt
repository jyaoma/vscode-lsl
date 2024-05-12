// scripts and notes:
// (1) scripts 

key     owner;
key     nQ;
integer sound_total;
integer thissound;
integer running = FALSE;
integer anim_total;
integer thisanim;
integer nline;
// float   CLIP_LEN = 10.0;
float   CLIP_LEN = 26.455;
float   DURATION;
float   CLIP_TIME;
string  nname;
string  this_anim;
string  sound_name;

list    anims = [];
list    times = [];

fText(integer start, integer clear) {
    llSetText(
        llList2String(["Complete\nLoaded " + (string)anim_total + " Animations.", "Reading ..."], start), 
        llList2Vector([<0.5, 1.0, 0.5>, <1.0, 0.5, 0.5>], start), 1);
    if (clear) {
        llSleep(2);
        llSetText("", ZERO_VECTOR, 0);
    }
}

fRunning(integer on) {
    llSetText("Playing\n" + sound_name 
        + "\nAnim : " + this_anim, <1.0, 1.0, 1.0>, on);
}

fNextLine() {
    nline ++;
    nQ = llGetNotecardLine(nname, nline);
}

fPreLoad(integer x) {
    llSetText("PreLoading...", <0.5, 0.5, 1.0>, 1);
    for(; x<sound_total; x++) {
        llPlaySound(llGetInventoryName(INVENTORY_SOUND,x),0.0);
        llSleep(0.5);
    }
    fText(FALSE,TRUE);
}

fPlaySound() {
    sound_name = llGetInventoryName(INVENTORY_SOUND,thissound);
    llSetSoundQueueing(TRUE);
    llLoopSound(sound_name, 1.0);
    thissound ++;
    thissound = llList2Integer([thissound, 0], (thissound >= sound_total));
    CLIP_TIME = CLIP_LEN;;
}

fPlayAnim() {
    this_anim = llList2String(anims, thisanim);
    DURATION = llList2Float(times, thisanim);
    thisanim ++;
    thisanim = llList2Integer([thisanim, 0], (thisanim >= anim_total));
    fStartAnim();
}

fStopAnim(integer trip) {
    if (llGetPermissions() & PERMISSION_TRIGGER_ANIMATION) {
        if (llGetPermissionsKey() == owner) {
            if (llGetInventoryType(this_anim) == INVENTORY_ANIMATION) {
                while ( trip -- ) {
                    llStopAnimation(this_anim);
                }
            }
        }
    }
}

fStartAnim() {
    if (llGetPermissions() & PERMISSION_TRIGGER_ANIMATION) {
        if (llGetPermissionsKey() == owner) {
            if (llGetInventoryType(this_anim) == INVENTORY_ANIMATION) {
                llStartAnimation(this_anim);
            } else {
                llOwnerSay("Missing Animation '" + this_anim + "' !");
            }
        }
    }
}

default
{
    state_entry()
    {
        fText(TRUE,FALSE);
        owner = llGetOwner();
        sound_total = llGetInventoryNumber(INVENTORY_SOUND);
        nname = llGetInventoryName(INVENTORY_NOTECARD,0);
        if (llGetInventoryType(nname) == INVENTORY_NOTECARD) {
            fNextLine();
        }
        if (llGetAttached() > 0) {
            llRequestPermissions(owner, PERMISSION_TRIGGER_ANIMATION);
        }
    }
    on_rez( integer n ) {       llResetScript();    }
    touch_start( integer t )
    {
        if (llGetAttached() > 0) {
            running = !running;
            thissound = thisanim = 0;
            if (running) {
                fPlaySound();
                fPlayAnim();
            }
            else {
                fStopAnim(2);
                llStopSound();
            }
            llSetTimerEvent(llList2Float([0, 0.1], running));
            fRunning(running);
        }
    }
    timer()
    {
        DURATION -= 0.1;
        if (DURATION <= 0.0) {
            fStopAnim(2);
            fPlayAnim();
        }
        CLIP_TIME -= 0.1;
        if (CLIP_TIME <= 0.0) {
            fPlaySound();
        }
        fRunning(TRUE);
    }
    dataserver (key hmpf, string data)    {
        if (hmpf == nQ) {
            if (data != EOF) {
                data = llStringTrim(data, STRING_TRIM);
                if (data != "" && llGetSubString(data, 0, 1) != "//") {
                    list n = llParseString2List(data,["|"],[]);
                    string item = llStringTrim(llList2String( n,0 ), STRING_TRIM);
                    
                    if (item == "CLIP") {
                        CLIP_LEN = llList2Float( n,1 );
                    }
                    else if (item == "ANIM") {
                        if (llGetListLength(n) == 3) {
                            anims += llStringTrim(llList2String( n,1 ), STRING_TRIM);
                            times += llList2Float( n,2 );
                        }
                    }
                }
                fNextLine();
            }
            else {
                anim_total = llGetListLength(anims);
                fPreLoad(0);
            }
        }
    }
    changed( integer c )
    {
        if (c & CHANGED_INVENTORY || c & CHANGED_OWNER)  {
            llResetScript();
        }
    }
}
// (2) notes
//  Sound Clip Length - If you hear a gap between sound files, lower this value

// CLIP | 26.455

//  List Animations + Durations

// ANIM | F-Leni 06 | 45.19
// ANIM | F-Leni 36 | 38.45
// ANIM | F-Leni 42 | 42.94
// ANIM | F-Leni 06 | 45.19
// ANIM | F-Leni 36 | 38.45
// ANIM | F-Leni 42 | 42.94