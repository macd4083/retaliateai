import React from 'react';

const InsightsV2 = () => {
    return (
        <div>
            {/* Other sections */}
            
            {/* Commitments Section */}
            <h2 className='text-xs'>Commitments</h2>
            <p className='text-xs'>Commitment text here...</p>
            <button className='text-xs'>Show more</button>
            <p className='text-sm'>Streak count: ...</p>
            <p className='text-xs'>Keep showing up.</p>

            {/* Recent Progress Section */}
            <h2 className='text-xs'>Recent Progress</h2>
            <p className='text-xs'>Win item text...</p>
            <p className='text-xs'>Empty-state text...</p>

            {/* What's Shifting Section */}
            <h2 className='text-xs'>What's Shifting</h2>
            <p className='text-xs'>Event display text...</p>

            {/* Your Goals Section */}
            <h2 className='text-xs'>Your Goals</h2>
            <p className='text-xs'>Empty goals text...</p>
            <p className='text-xs'>Goal title...</p>

            {/* What We've Noticed Section */}
            <h2 className='text-xs'>What We've Noticed</h2>
            <p className='text-xs'>Narrative text...</p>
            <p className='text-xs'>Empty-state narrative text...</p>
        </div>
    );
};

export default InsightsV2;